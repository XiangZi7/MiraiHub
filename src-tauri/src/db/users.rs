//! 用户与权限管理：列出账号/角色、读取授权，以及生成并执行账号相关 DDL。
//!
//! 前端只提交结构化的 `UserAction`，SQL 一律在这里拼装：预览时密码打码，
//! 执行时用同一套逻辑重新生成，避免执行内容与预览不一致。

use serde::{Deserialize, Serialize};
use sqlx::Row;

use super::error::{DatabaseError, DatabaseResult};
use super::manager::DatabasePool;
use super::metadata::mysql_optional_metadata_text;
use super::models::DatabaseKind;
use super::sql::{quote_identifier, quote_literal};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAccount {
    pub name: String,
    /// MySQL 账号的 Host 部分；PostgreSQL 角色为 None。
    pub host: Option<String>,
    /// 展示用标签：超级用户、可登录、已锁定、认证插件等。
    pub attributes: Vec<String>,
    /// PostgreSQL 角色所属的其他角色。
    pub member_of: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountList {
    pub accounts: Vec<DatabaseAccount>,
    pub notice: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GrantLevel {
    /// MySQL `*.*`。
    #[default]
    Global,
    Database,
    /// PostgreSQL schema 及其下所有表。
    Schema,
    Table,
    /// PostgreSQL 角色成员关系：`GRANT role TO user`。
    Role,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GrantScope {
    pub level: GrantLevel,
    pub database: String,
    pub schema: String,
    pub table: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantEntry {
    /// 原始授权语句（MySQL 为 SHOW GRANTS 输出）。
    pub sql: String,
    pub privileges: Vec<String>,
    /// 能解析成结构化范围时才给出，前端据此提供“撤销”。
    pub scope: Option<GrantScope>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum UserAction {
    Create {
        name: String,
        #[serde(default)]
        host: String,
        password: String,
        /// PostgreSQL：是否允许登录（否则只是角色）。
        #[serde(default = "default_true")]
        login: bool,
    },
    Drop {
        name: String,
        #[serde(default)]
        host: String,
    },
    ChangePassword {
        name: String,
        #[serde(default)]
        host: String,
        password: String,
    },
    Grant {
        name: String,
        #[serde(default)]
        host: String,
        privileges: Vec<String>,
        scope: GrantScope,
        #[serde(default)]
        with_grant_option: bool,
    },
    Revoke {
        name: String,
        #[serde(default)]
        host: String,
        privileges: Vec<String>,
        scope: GrantScope,
    },
}

fn default_true() -> bool {
    true
}

impl UserAction {
    /// 删除账号与撤销授权在生产环境需要二次确认。
    pub fn dangerous(&self) -> Option<String> {
        match self {
            UserAction::Drop { name, .. } => Some(format!("删除用户 {name}")),
            UserAction::Revoke { name, .. } => Some(format!("撤销 {name} 的权限")),
            _ => None,
        }
    }
}

pub async fn list_accounts(pool: &DatabasePool) -> DatabaseResult<AccountList> {
    match pool {
        DatabasePool::Mysql(pool) => mysql_accounts(pool).await,
        DatabasePool::Postgresql(pool) => postgresql_accounts(pool).await,
        DatabasePool::Sqlite(_) => Err(unsupported()),
    }
}

pub async fn list_grants(
    pool: &DatabasePool,
    name: &str,
    host: &str,
) -> DatabaseResult<Vec<GrantEntry>> {
    match pool {
        DatabasePool::Mysql(pool) => {
            let sql = format!("SHOW GRANTS FOR {}", mysql_account(name, host));
            let rows = sqlx::query(&sql)
                .fetch_all(pool)
                .await
                .map_err(DatabaseError::Query)?;
            Ok(rows
                .iter()
                .filter_map(first_column_text)
                .map(|sql| {
                    let (privileges, scope) = parse_mysql_grant(&sql).unzip();
                    GrantEntry {
                        sql,
                        privileges: privileges.unwrap_or_default(),
                        scope,
                    }
                })
                .collect())
        }
        DatabasePool::Postgresql(pool) => postgresql_grants(pool, name).await,
        DatabasePool::Sqlite(_) => Err(unsupported()),
    }
}

/// 生成动作对应的 SQL。`mask` 为 true 时密码替换成星号，仅用于预览。
pub fn build_statements(
    kind: DatabaseKind,
    action: &UserAction,
    mask: bool,
) -> DatabaseResult<Vec<String>> {
    let secret = |password: &str| -> DatabaseResult<String> {
        if password.is_empty() {
            return Err(DatabaseError::InvalidInput("密码不能为空".to_owned()));
        }
        let shown = if mask { "******" } else { password };
        Ok(match kind {
            DatabaseKind::Mysql => mysql_literal(shown),
            _ => quote_literal(shown),
        })
    };
    let check_name = |name: &str| -> DatabaseResult<()> {
        if name.trim().is_empty() {
            return Err(DatabaseError::InvalidInput("用户名不能为空".to_owned()));
        }
        Ok(())
    };

    match kind {
        DatabaseKind::Sqlite => Err(unsupported()),
        DatabaseKind::Mysql => match action {
            UserAction::Create {
                name,
                host,
                password,
                ..
            } => {
                check_name(name)?;
                Ok(vec![format!(
                    "CREATE USER {} IDENTIFIED BY {}",
                    mysql_account(name, host),
                    secret(password)?
                )])
            }
            UserAction::Drop { name, host } => {
                check_name(name)?;
                Ok(vec![format!("DROP USER {}", mysql_account(name, host))])
            }
            UserAction::ChangePassword {
                name,
                host,
                password,
            } => {
                check_name(name)?;
                Ok(vec![format!(
                    "ALTER USER {} IDENTIFIED BY {}",
                    mysql_account(name, host),
                    secret(password)?
                )])
            }
            UserAction::Grant {
                name,
                host,
                privileges,
                scope,
                with_grant_option,
            } => {
                check_name(name)?;
                let mut sql = format!(
                    "GRANT {} ON {} TO {}",
                    privilege_list(privileges)?,
                    mysql_scope(scope)?,
                    mysql_account(name, host)
                );
                if *with_grant_option {
                    sql.push_str(" WITH GRANT OPTION");
                }
                Ok(vec![sql])
            }
            UserAction::Revoke {
                name,
                host,
                privileges,
                scope,
            } => {
                check_name(name)?;
                Ok(vec![format!(
                    "REVOKE {} ON {} FROM {}",
                    privilege_list(privileges)?,
                    mysql_scope(scope)?,
                    mysql_account(name, host)
                )])
            }
        },
        DatabaseKind::Postgresql => {
            let role = |name: &str| quote_identifier(name, kind);
            match action {
                UserAction::Create {
                    name,
                    password,
                    login,
                    ..
                } => {
                    check_name(name)?;
                    let login = if *login { "LOGIN" } else { "NOLOGIN" };
                    Ok(vec![if password.is_empty() {
                        format!("CREATE ROLE {} WITH {login}", role(name))
                    } else {
                        format!(
                            "CREATE ROLE {} WITH {login} PASSWORD {}",
                            role(name),
                            secret(password)?
                        )
                    }])
                }
                UserAction::Drop { name, .. } => {
                    check_name(name)?;
                    Ok(vec![format!("DROP ROLE {}", role(name))])
                }
                UserAction::ChangePassword { name, password, .. } => {
                    check_name(name)?;
                    Ok(vec![format!(
                        "ALTER ROLE {} WITH PASSWORD {}",
                        role(name),
                        secret(password)?
                    )])
                }
                UserAction::Grant {
                    name,
                    privileges,
                    scope,
                    with_grant_option,
                    ..
                } => {
                    check_name(name)?;
                    let suffix = if *with_grant_option {
                        if matches!(scope.level, GrantLevel::Role) {
                            " WITH ADMIN OPTION"
                        } else {
                            " WITH GRANT OPTION"
                        }
                    } else {
                        ""
                    };
                    postgresql_targets(privileges, scope)?
                        .into_iter()
                        .map(|(privileges, target)| {
                            Ok(match target {
                                Some(target) => format!(
                                    "GRANT {privileges} ON {target} TO {}{suffix}",
                                    role(name)
                                ),
                                None => format!("GRANT {privileges} TO {}{suffix}", role(name)),
                            })
                        })
                        .collect()
                }
                UserAction::Revoke {
                    name,
                    privileges,
                    scope,
                    ..
                } => {
                    check_name(name)?;
                    postgresql_targets(privileges, scope)?
                        .into_iter()
                        .map(|(privileges, target)| {
                            Ok(match target {
                                Some(target) => {
                                    format!("REVOKE {privileges} ON {target} FROM {}", role(name))
                                }
                                None => format!("REVOKE {privileges} FROM {}", role(name)),
                            })
                        })
                        .collect()
                }
            }
        }
    }
}

pub async fn apply(
    pool: &DatabasePool,
    statements: &[String],
) -> DatabaseResult<()> {
    for statement in statements {
        match pool {
            DatabasePool::Mysql(pool) => sqlx::raw_sql(statement).execute(pool).await.map(|_| ()),
            DatabasePool::Postgresql(pool) => {
                sqlx::raw_sql(statement).execute(pool).await.map(|_| ())
            }
            DatabasePool::Sqlite(_) => return Err(unsupported()),
        }
        .map_err(DatabaseError::Query)?;
    }
    Ok(())
}

fn unsupported() -> DatabaseError {
    DatabaseError::InvalidInput("SQLite 没有用户与权限体系".to_owned())
}

/// MySQL 字符串字面量：默认 sql_mode 下反斜杠也是转义符。
fn mysql_literal(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "''"))
}

fn mysql_account(name: &str, host: &str) -> String {
    let host = if host.trim().is_empty() { "%" } else { host.trim() };
    format!("{}@{}", mysql_literal(name), mysql_literal(host))
}

fn mysql_scope(scope: &GrantScope) -> DatabaseResult<String> {
    let db = |value: &str| -> DatabaseResult<String> {
        if value.trim().is_empty() {
            return Err(DatabaseError::InvalidInput("请选择数据库".to_owned()));
        }
        Ok(quote_identifier(value, DatabaseKind::Mysql))
    };
    Ok(match scope.level {
        GrantLevel::Global => "*.*".to_owned(),
        GrantLevel::Database | GrantLevel::Schema => format!("{}.*", db(&scope.database)?),
        GrantLevel::Table => {
            if scope.table.trim().is_empty() {
                return Err(DatabaseError::InvalidInput("请选择表".to_owned()));
            }
            format!(
                "{}.{}",
                db(&scope.database)?,
                quote_identifier(&scope.table, DatabaseKind::Mysql)
            )
        }
        GrantLevel::Role => {
            return Err(DatabaseError::InvalidInput(
                "MySQL 角色授权请在 SQL 编辑器中执行".to_owned(),
            ))
        }
    })
}

/// 权限名只允许字母、下划线和空格，拼接进 SQL 不会被注入。
fn privilege_list(privileges: &[String]) -> DatabaseResult<String> {
    let cleaned: Vec<String> = privileges
        .iter()
        .map(|privilege| privilege.trim().to_ascii_uppercase())
        .filter(|privilege| !privilege.is_empty())
        .collect();
    if cleaned.is_empty() {
        return Err(DatabaseError::InvalidInput("请至少选择一项权限".to_owned()));
    }
    if let Some(bad) = cleaned.iter().find(|privilege| {
        !privilege
            .chars()
            .all(|ch| ch.is_ascii_alphabetic() || ch == '_' || ch == ' ')
    }) {
        return Err(DatabaseError::InvalidInput(format!("不支持的权限：{bad}")));
    }
    Ok(cleaned.join(", "))
}

/// PostgreSQL 的授权目标：schema 级别会拆成“schema 本身”和“schema 下所有表”两条。
fn postgresql_targets(
    privileges: &[String],
    scope: &GrantScope,
) -> DatabaseResult<Vec<(String, Option<String>)>> {
    let kind = DatabaseKind::Postgresql;
    let required = |value: &str, what: &str| -> DatabaseResult<String> {
        if value.trim().is_empty() {
            return Err(DatabaseError::InvalidInput(format!("请选择{what}")));
        }
        Ok(quote_identifier(value, kind))
    };
    match scope.level {
        GrantLevel::Global => Err(DatabaseError::InvalidInput(
            "PostgreSQL 没有全局权限，请改用角色属性或选择具体对象".to_owned(),
        )),
        GrantLevel::Role => Ok(vec![(required(&scope.role, "角色")?, None)]),
        GrantLevel::Database => Ok(vec![(
            privilege_list(privileges)?,
            Some(format!("DATABASE {}", required(&scope.database, "数据库")?)),
        )]),
        GrantLevel::Table => Ok(vec![(
            privilege_list(privileges)?,
            Some(format!(
                "TABLE {}.{}",
                required(&scope.schema, " schema")?,
                required(&scope.table, "表")?
            )),
        )]),
        GrantLevel::Schema => {
            let schema = required(&scope.schema, " schema")?;
            let (schema_privs, table_privs): (Vec<String>, Vec<String>) = privileges
                .iter()
                .cloned()
                .partition(|privilege| {
                    matches!(privilege.trim().to_ascii_uppercase().as_str(), "USAGE" | "CREATE")
                });
            let mut targets = Vec::new();
            if !schema_privs.is_empty() {
                targets.push((privilege_list(&schema_privs)?, Some(format!("SCHEMA {schema}"))));
            }
            if !table_privs.is_empty() {
                targets.push((
                    privilege_list(&table_privs)?,
                    Some(format!("ALL TABLES IN SCHEMA {schema}")),
                ));
            }
            if targets.is_empty() {
                return Err(DatabaseError::InvalidInput("请至少选择一项权限".to_owned()));
            }
            Ok(targets)
        }
    }
}

/// 把 `GRANT a, b ON `db`.`t` TO ...` 解析成权限与范围；列级权限、角色授予等返回 None。
fn parse_mysql_grant(sql: &str) -> Option<(Vec<String>, GrantScope)> {
    let rest = sql.strip_prefix("GRANT ")?;
    let on = rest.find(" ON ")?;
    let privileges_text = &rest[..on];
    if privileges_text.contains('(') {
        return None;
    }
    let after = &rest[on + 4..];
    let to = after.find(" TO ")?;
    let object = after[..to].trim();
    let privileges: Vec<String> = privileges_text
        .split(',')
        .map(|item| item.trim().to_owned())
        .filter(|item| !item.is_empty() && item != "USAGE")
        .collect();
    if privileges.is_empty() {
        return None;
    }
    // 函数/过程级授权（ON PROCEDURE x）不在表单范围内。
    if object.starts_with("PROCEDURE ") || object.starts_with("FUNCTION ") {
        return None;
    }
    let (db, table) = split_mysql_object(object)?;
    let scope = match (db.as_str(), table.as_str()) {
        ("*", "*") => GrantScope::default(),
        (_, "*") => GrantScope {
            level: GrantLevel::Database,
            database: db,
            ..GrantScope::default()
        },
        _ => GrantScope {
            level: GrantLevel::Table,
            database: db,
            table,
            ..GrantScope::default()
        },
    };
    Some((privileges, scope))
}

fn split_mysql_object(object: &str) -> Option<(String, String)> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut chars = object.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '`' if quoted && chars.peek() == Some(&'`') => {
                chars.next();
                current.push('`');
            }
            '`' => quoted = !quoted,
            '.' if !quoted => parts.push(std::mem::take(&mut current)),
            _ => current.push(ch),
        }
    }
    parts.push(current);
    match parts.as_slice() {
        [db, table] => Some((db.clone(), table.clone())),
        _ => None,
    }
}

fn first_column_text(row: &sqlx::mysql::MySqlRow) -> Option<String> {
    row.try_get::<String, _>(0).ok().or_else(|| {
        row.try_get::<Vec<u8>, _>(0)
            .ok()
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
    })
}

async fn mysql_accounts(pool: &sqlx::MySqlPool) -> DatabaseResult<AccountList> {
    let full = sqlx::query(
        r#"
        SELECT CAST(User AS CHAR) AS USER, CAST(Host AS CHAR) AS HOST,
               CAST(plugin AS CHAR) AS PLUGIN, CAST(account_locked AS CHAR) AS LOCKED,
               CAST(password_expired AS CHAR) AS EXPIRED, CAST(Super_priv AS CHAR) AS SUPER
        FROM mysql.user ORDER BY User, Host
        "#,
    )
    .fetch_all(pool)
    .await;
    let rows = match full {
        Ok(rows) => rows,
        Err(_) => {
            // 没有 mysql.user 的读权限：只展示当前账号。
            let current: String = sqlx::query_scalar("SELECT CAST(CURRENT_USER() AS CHAR)")
                .fetch_one(pool)
                .await
                .map_err(DatabaseError::Query)?;
            let (name, host) = current.rsplit_once('@').unwrap_or((&current, "%"));
            return Ok(AccountList {
                accounts: vec![DatabaseAccount {
                    name: name.to_owned(),
                    host: Some(host.to_owned()),
                    attributes: vec!["当前账号".to_owned()],
                    member_of: Vec::new(),
                }],
                notice: Some("当前账号无权读取 mysql.user，只显示自己".to_owned()),
            });
        }
    };

    let mut accounts = Vec::with_capacity(rows.len());
    for row in &rows {
        let mut attributes = Vec::new();
        if mysql_optional_metadata_text(row, "SUPER")?.as_deref() == Some("Y") {
            attributes.push("超级权限".to_owned());
        }
        if mysql_optional_metadata_text(row, "LOCKED")?.as_deref() == Some("Y") {
            attributes.push("已锁定".to_owned());
        }
        if mysql_optional_metadata_text(row, "EXPIRED")?.as_deref() == Some("Y") {
            attributes.push("密码已过期".to_owned());
        }
        if let Some(plugin) = mysql_optional_metadata_text(row, "PLUGIN")?.filter(|p| !p.is_empty()) {
            attributes.push(plugin);
        }
        accounts.push(DatabaseAccount {
            name: mysql_optional_metadata_text(row, "USER")?.unwrap_or_default(),
            host: mysql_optional_metadata_text(row, "HOST")?,
            attributes,
            member_of: Vec::new(),
        });
    }
    Ok(AccountList {
        accounts,
        notice: None,
    })
}

async fn postgresql_accounts(pool: &sqlx::PgPool) -> DatabaseResult<AccountList> {
    let rows = sqlx::query(
        r#"
        SELECT r.rolname::text AS name, r.rolsuper, r.rolcanlogin, r.rolcreatedb,
               r.rolcreaterole, r.rolreplication,
               COALESCE(r.rolvaliduntil::text, '') AS valid_until,
               ARRAY(SELECT b.rolname::text FROM pg_auth_members m
                     JOIN pg_roles b ON m.roleid = b.oid
                     WHERE m.member = r.oid ORDER BY 1) AS member_of
        FROM pg_roles r
        WHERE r.rolname !~ '^pg_'
        ORDER BY r.rolname
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    let mut accounts = Vec::with_capacity(rows.len());
    for row in &rows {
        let flag = |column: &str| row.try_get::<bool, _>(column).unwrap_or(false);
        let mut attributes = Vec::new();
        if flag("rolsuper") {
            attributes.push("超级用户".to_owned());
        }
        attributes.push(if flag("rolcanlogin") { "可登录" } else { "角色" }.to_owned());
        if flag("rolcreatedb") {
            attributes.push("可建库".to_owned());
        }
        if flag("rolcreaterole") {
            attributes.push("可建角色".to_owned());
        }
        if flag("rolreplication") {
            attributes.push("复制".to_owned());
        }
        let valid_until: String = row.try_get("valid_until").map_err(DatabaseError::Query)?;
        if !valid_until.is_empty() && valid_until != "infinity" {
            attributes.push(format!("有效期至 {valid_until}"));
        }
        accounts.push(DatabaseAccount {
            name: row.try_get("name").map_err(DatabaseError::Query)?,
            host: None,
            attributes,
            member_of: row.try_get("member_of").map_err(DatabaseError::Query)?,
        });
    }
    Ok(AccountList {
        accounts,
        notice: None,
    })
}

async fn postgresql_grants(pool: &sqlx::PgPool, role: &str) -> DatabaseResult<Vec<GrantEntry>> {
    // aclexplode 能读到所有授予该角色的对象权限，不受 information_schema 的可见性限制。
    let rows = sqlx::query(
        r#"
        WITH target AS (SELECT oid FROM pg_roles WHERE rolname = $1)
        SELECT 'database' AS level, d.datname::text AS db, '' AS schema, '' AS object,
               string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privileges,
               bool_or(a.is_grantable) AS grantable
        FROM pg_database d, aclexplode(d.datacl) a, target
        WHERE a.grantee = target.oid
        GROUP BY d.datname
        UNION ALL
        SELECT 'schema', current_database()::text, n.nspname::text, '',
               string_agg(a.privilege_type, ',' ORDER BY a.privilege_type), bool_or(a.is_grantable)
        FROM pg_namespace n, aclexplode(n.nspacl) a, target
        WHERE a.grantee = target.oid
        GROUP BY n.nspname
        UNION ALL
        SELECT 'table', current_database()::text, n.nspname::text, c.relname::text,
               string_agg(a.privilege_type, ',' ORDER BY a.privilege_type), bool_or(a.is_grantable)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace,
        aclexplode(c.relacl) a, target
        WHERE a.grantee = target.oid AND c.relkind IN ('r', 'v', 'm', 'p', 'f', 'S')
        GROUP BY n.nspname, c.relname
        UNION ALL
        SELECT 'role', '', '', b.rolname::text, '', m.admin_option
        FROM pg_auth_members m
        JOIN pg_roles b ON b.oid = m.roleid, target
        WHERE m.member = target.oid
        ORDER BY 1, 2, 3, 4
        "#,
    )
    .bind(role)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    let kind = DatabaseKind::Postgresql;
    let grantee = quote_identifier(role, kind);
    let mut entries = Vec::with_capacity(rows.len());
    for row in &rows {
        let level: String = row.try_get("level").map_err(DatabaseError::Query)?;
        let database: String = row.try_get("db").map_err(DatabaseError::Query)?;
        let schema: String = row.try_get("schema").map_err(DatabaseError::Query)?;
        let object: String = row.try_get("object").map_err(DatabaseError::Query)?;
        let privileges_text: String = row.try_get("privileges").map_err(DatabaseError::Query)?;
        let grantable: bool = row.try_get::<Option<bool>, _>("grantable").ok().flatten().unwrap_or(false);
        let privileges: Vec<String> = privileges_text
            .split(',')
            .filter(|item| !item.is_empty())
            .map(str::to_owned)
            .collect();
        let suffix = if grantable { " WITH GRANT OPTION" } else { "" };
        let (sql, scope) = match level.as_str() {
            "database" => (
                format!(
                    "GRANT {} ON DATABASE {} TO {grantee}{suffix}",
                    privileges.join(", "),
                    quote_identifier(&database, kind)
                ),
                GrantScope {
                    level: GrantLevel::Database,
                    database,
                    ..GrantScope::default()
                },
            ),
            "schema" => (
                format!(
                    "GRANT {} ON SCHEMA {} TO {grantee}{suffix}",
                    privileges.join(", "),
                    quote_identifier(&schema, kind)
                ),
                GrantScope {
                    level: GrantLevel::Schema,
                    database,
                    schema,
                    ..GrantScope::default()
                },
            ),
            "table" => (
                format!(
                    "GRANT {} ON TABLE {}.{} TO {grantee}{suffix}",
                    privileges.join(", "),
                    quote_identifier(&schema, kind),
                    quote_identifier(&object, kind)
                ),
                GrantScope {
                    level: GrantLevel::Table,
                    database,
                    schema,
                    table: object,
                    ..GrantScope::default()
                },
            ),
            _ => (
                format!(
                    "GRANT {} TO {grantee}{}",
                    quote_identifier(&object, kind),
                    if grantable { " WITH ADMIN OPTION" } else { "" }
                ),
                GrantScope {
                    level: GrantLevel::Role,
                    role: object,
                    ..GrantScope::default()
                },
            ),
        };
        entries.push(GrantEntry {
            sql,
            privileges,
            scope: Some(scope),
        });
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mysql_grant_lines() {
        let (privileges, scope) =
            parse_mysql_grant("GRANT SELECT, INSERT ON `shop`.`orders` TO `app`@`%`").unwrap();
        assert_eq!(privileges, vec!["SELECT", "INSERT"]);
        assert!(matches!(scope.level, GrantLevel::Table));
        assert_eq!(scope.database, "shop");
        assert_eq!(scope.table, "orders");
        assert!(parse_mysql_grant("GRANT USAGE ON *.* TO `app`@`%`").is_none());
        assert!(parse_mysql_grant("GRANT SELECT (`id`) ON `a`.`b` TO `x`@`%`").is_none());
    }

    #[test]
    fn masks_password_in_preview() {
        let action = UserAction::Create {
            name: "app".into(),
            host: "%".into(),
            password: "s'e\\cret".into(),
            login: true,
        };
        let preview = build_statements(DatabaseKind::Mysql, &action, true).unwrap();
        assert_eq!(preview, vec!["CREATE USER 'app'@'%' IDENTIFIED BY '******'"]);
        let real = build_statements(DatabaseKind::Mysql, &action, false).unwrap();
        assert_eq!(real, vec!["CREATE USER 'app'@'%' IDENTIFIED BY 's''e\\\\cret'"]);
    }

    #[test]
    fn rejects_injected_privileges() {
        let action = UserAction::Grant {
            name: "app".into(),
            host: String::new(),
            privileges: vec!["SELECT; DROP TABLE x".into()],
            scope: GrantScope::default(),
            with_grant_option: false,
        };
        assert!(build_statements(DatabaseKind::Mysql, &action, true).is_err());
    }

    #[test]
    fn splits_postgresql_schema_grants() {
        let action = UserAction::Grant {
            name: "app".into(),
            host: String::new(),
            privileges: vec!["USAGE".into(), "SELECT".into()],
            scope: GrantScope {
                level: GrantLevel::Schema,
                schema: "public".into(),
                ..GrantScope::default()
            },
            with_grant_option: false,
        };
        let sql = build_statements(DatabaseKind::Postgresql, &action, true).unwrap();
        assert_eq!(
            sql,
            vec![
                "GRANT USAGE ON SCHEMA \"public\" TO \"app\"",
                "GRANT SELECT ON ALL TABLES IN SCHEMA \"public\" TO \"app\"",
            ]
        );
    }
}
