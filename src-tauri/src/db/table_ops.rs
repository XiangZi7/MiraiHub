//! 表级选项读写与数据清理。
//!
//! 引擎/字符集/自增计数器属于表选项，与结构 DDL 分开：MySQL 在一条
//! `ALTER TABLE` 里合并修改，PostgreSQL 走 `COMMENT ON` 与 identity 列
//! `RESTART WITH`。所有动态选项值都在 Rust 侧校验，前端不能直接拼 SQL。

use sqlx::mysql::MySqlPool;
use sqlx::postgres::PgPool;
use sqlx::Row;

use super::error::{DatabaseError, DatabaseResult};
use super::manager::DatabasePool;
use super::models::{DatabaseKind, DatabaseTableOptions, TableAlterOptions};
use super::sql;

/// 读取一张表的当前选项。视图没有这些选项，返回 None。
pub async fn read_table_options(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Option<DatabaseTableOptions>> {
    let schema = valid_name(schema, "schema")?;
    let name = valid_name(name, "对象名")?;

    match pool {
        DatabasePool::Mysql(pool) => mysql_table_options(pool, schema, name).await,
        DatabasePool::Postgresql(pool) => postgresql_table_options(pool, schema, name).await,
    }
}

/// 修改表选项。只修改传入的非空选项；没有任何改动时不发语句。
pub async fn alter_table_options(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
    options: &TableAlterOptions,
) -> DatabaseResult<Vec<String>> {
    let schema = valid_name(schema, "schema")?;
    let name = valid_name(name, "对象名")?;
    let dialect = pool.kind();
    let target = sql::qualified_name(schema, name, dialect);

    let mut statements: Vec<String> = Vec::new();

    if dialect == DatabaseKind::Mysql {
        let mut clauses: Vec<String> = Vec::new();
        if let Some(engine) = options.engine.as_deref() {
            clauses.push(format!("ENGINE={}", safe_option(engine, "存储引擎")?));
        }
        if let Some(charset) = options.charset.as_deref() {
            let charset = safe_option(charset, "字符集")?;
            match options.collation.as_deref() {
                Some(collation) => clauses.push(format!(
                    "DEFAULT CHARSET={} COLLATE={}",
                    charset,
                    safe_option(collation, "排序规则")?
                )),
                None => clauses.push(format!("DEFAULT CHARSET={charset}")),
            }
        }
        if let Some(comment) = options.comment.as_deref() {
            clauses.push(format!("COMMENT={}", valid_comment(comment)?));
        }
        if let Some(next_value) = options.auto_increment {
            clauses.push(format!(
                "AUTO_INCREMENT={}",
                valid_auto_increment(next_value)?
            ));
        }
        if !clauses.is_empty() {
            statements.push(format!("ALTER TABLE {target} {}", clauses.join(", ")));
        }
    } else {
        if let Some(comment) = options.comment.as_deref() {
            statements.push(format!(
                "COMMENT ON TABLE {target} IS {}",
                valid_comment(comment)?
            ));
        }
        // PostgreSQL 的自增当前值只作用于 identity 列；serial 序列的当前值
        // 属于序列对象，改它需要显式操作序列，这里明确拒绝而不是猜列名。
        if let Some(next_value) = options.auto_increment {
            let column = match pool {
                DatabasePool::Postgresql(pg) => pg_identity_column(pg, schema, name).await?,
                DatabasePool::Mysql(_) => None,
            };
            match column {
                Some(column) => statements.push(format!(
                    "ALTER TABLE {target} ALTER COLUMN {} RESTART WITH {}",
                    sql::quote_identifier(&column, dialect),
                    valid_auto_increment(next_value)?
                )),
                None => {
                    return Err(DatabaseError::InvalidInput(
                        "该表的 PostgreSQL 自增列不是 identity 列（可能是 serial 序列），当前不支持在此修改自增值；请在查询中执行 ALTER SEQUENCE".to_owned(),
                    ))
                }
            }
        }
    }

    for statement in &statements {
        execute(pool, statement).await?;
    }
    Ok(statements)
}

/// 清空表数据。MySQL 走 TRUNCATE（隐式提交、重置自增）；PostgreSQL 同样
/// 支持 TRUNCATE，且可归属到外键链，需要时由服务端报错提示。
pub async fn truncate_table(pool: &DatabasePool, schema: &str, name: &str) -> DatabaseResult<()> {
    let schema = valid_name(schema, "schema")?;
    let name = valid_name(name, "对象名")?;
    let target = sql::qualified_name(schema, name, pool.kind());
    execute(pool, &format!("TRUNCATE TABLE {target}")).await
}

async fn mysql_table_options(
    pool: &MySqlPool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Option<DatabaseTableOptions>> {
    let rows = sqlx::query(
        r#"
        SELECT ENGINE, TABLE_COLLATION, TABLE_COMMENT, AUTO_INCREMENT
        FROM information_schema.tables
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'
        "#,
    )
    .bind(schema)
    .bind(name)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    let Some(row) = rows.into_iter().next() else {
        return Ok(None);
    };

    // 排序规则形如 utf8mb4_0900_ai_ci，字符集取下划线前的部分。
    let collation = super::metadata::mysql_optional_metadata_text(&row, "TABLE_COLLATION")?;
    let charset = collation
        .as_deref()
        .and_then(|value| value.split('_').next())
        .map(str::to_owned);

    Ok(Some(DatabaseTableOptions {
        engine: super::metadata::mysql_optional_metadata_text(&row, "ENGINE")?,
        charset,
        collation,
        comment: super::metadata::mysql_optional_metadata_text(&row, "TABLE_COMMENT")?,
        auto_increment: row.try_get::<i64, _>("AUTO_INCREMENT").ok(),
    }))
}

async fn postgresql_table_options(
    pool: &PgPool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Option<DatabaseTableOptions>> {
    let rows = sqlx::query(
        r#"
        SELECT obj_description(c.oid, 'pg_class') AS table_comment
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
          AND c.relkind IN ('r', 'p')
        "#,
    )
    .bind(schema)
    .bind(name)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    let Some(row) = rows.into_iter().next() else {
        return Ok(None);
    };

    Ok(Some(DatabaseTableOptions {
        engine: None,
        charset: None,
        collation: None,
        comment: row.try_get("table_comment").unwrap_or(None),
        auto_increment: None,
    }))
}

/// identity 列（attidentity 非空）的名字；serial 序列不算，返回 None。
async fn pg_identity_column(
    pool: &PgPool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Option<String>> {
    let rows = sqlx::query(
        r#"
        SELECT a.attname AS column_name
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
          AND a.attnum > 0 AND NOT a.attisdropped
          AND a.attidentity <> ''
        ORDER BY a.attnum
        LIMIT 1
        "#,
    )
    .bind(schema)
    .bind(name)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    Ok(rows
        .into_iter()
        .next()
        .and_then(|row| row.try_get::<String, _>("column_name").ok()))
}

async fn execute(pool: &DatabasePool, statement: &str) -> DatabaseResult<()> {
    match pool {
        DatabasePool::Mysql(pool) => sqlx::query(statement).execute(pool).await.map(|_| ()),
        DatabasePool::Postgresql(pool) => sqlx::query(statement).execute(pool).await.map(|_| ()),
    }
    .map_err(DatabaseError::Query)
}

fn valid_name<'a>(name: &'a str, label: &str) -> DatabaseResult<&'a str> {
    let name = name.trim();
    if name.is_empty() {
        return Err(DatabaseError::InvalidInput(format!("{label}不能为空")));
    }
    if name.chars().any(char::is_control) {
        return Err(DatabaseError::InvalidInput(format!(
            "{label}不能包含控制字符"
        )));
    }
    Ok(name)
}

fn safe_option<'a>(value: &'a str, label: &str) -> DatabaseResult<&'a str> {
    let value = value.trim();
    if value.is_empty() {
        return Err(DatabaseError::InvalidInput(format!("{label}不能为空")));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(DatabaseError::InvalidInput(format!(
            "{label}只能包含字母、数字、下划线和连字符"
        )));
    }
    Ok(value)
}

fn valid_comment(value: &str) -> DatabaseResult<String> {
    if value.chars().any(char::is_control) {
        return Err(DatabaseError::InvalidInput(
            "表备注不能包含控制字符".to_owned(),
        ));
    }
    Ok(sql::quote_literal(value))
}

fn valid_auto_increment(value: i64) -> DatabaseResult<i64> {
    if value < 1 {
        return Err(DatabaseError::InvalidInput(
            "自增值必须是不小于 1 的整数".to_owned(),
        ));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mysql_options_build_single_alter() {
        let pool = DatabaseKind::Mysql;
        let target = sql::qualified_name("db", "users", pool);
        let mut options = TableAlterOptions::default();
        options.engine = Some("InnoDB".to_owned());
        options.charset = Some("utf8mb4".to_owned());
        options.comment = Some("用户表".to_owned());
        options.auto_increment = Some(1000);

        let clauses = [
            format!(
                "ENGINE={}",
                safe_option(options.engine.as_deref().unwrap(), "存储引擎").unwrap()
            ),
            format!(
                "DEFAULT CHARSET={} COLLATE={}",
                safe_option(options.charset.as_deref().unwrap(), "字符集").unwrap(),
                safe_option(
                    options.collation.as_deref().unwrap_or("utf8mb4_0900_ai_ci"),
                    "排序规则"
                )
                .unwrap()
            ),
            format!(
                "COMMENT={}",
                valid_comment(options.comment.as_deref().unwrap()).unwrap()
            ),
            format!(
                "AUTO_INCREMENT={}",
                valid_auto_increment(options.auto_increment.unwrap()).unwrap()
            ),
        ];
        let statement = format!("ALTER TABLE {target} {}", clauses.join(", "));
        assert_eq!(
            statement,
            "ALTER TABLE `db`.`users` ENGINE=InnoDB, DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci, COMMENT='用户表', AUTO_INCREMENT=1000"
        );
    }

    #[test]
    fn rejects_bad_engine_and_charset() {
        assert!(safe_option("InnoDB; DROP", "存储引擎").is_err());
        assert!(safe_option("utf8mb4'--", "字符集").is_err());
        assert!(safe_option("InnoDB", "存储引擎").is_ok());
    }

    #[test]
    fn rejects_low_auto_increment() {
        assert!(valid_auto_increment(0).is_err());
        assert!(valid_auto_increment(-1).is_err());
        assert_eq!(valid_auto_increment(1).unwrap(), 1);
    }

    #[test]
    fn rejects_control_characters_in_comment() {
        assert!(valid_comment("备注\nDROP").is_err());
        assert!(valid_comment("正常备注").is_ok());
    }

    #[test]
    fn charset_derives_from_collation_prefix() {
        let collation = "utf8mb4_0900_ai_ci".to_owned();
        let charset = collation.split('_').next().map(str::to_owned);
        assert_eq!(charset.as_deref(), Some("utf8mb4"));
    }
}
