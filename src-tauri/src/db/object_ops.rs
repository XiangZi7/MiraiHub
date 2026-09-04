//! 数据库对象级 DDL 操作。
//!
//! 所有对象名都在 Rust 侧按方言引用；前端只传结构化目标，不能直接拼接 SQL。

use super::error::{DatabaseError, DatabaseResult};
use super::manager::DatabasePool;
use super::models::{DatabaseKind, DatabaseObjectKind};
use super::sql;

pub async fn create_database(pool: &DatabasePool, name: &str) -> DatabaseResult<()> {
    let name = valid_name(name, "数据库名")?;
    let statement = format!(
        "CREATE DATABASE {}",
        sql::quote_identifier(name, pool.kind())
    );
    execute(pool, &statement).await
}

pub async fn rename_database(
    pool: &DatabasePool,
    old_name: &str,
    new_name: &str,
) -> DatabaseResult<()> {
    let old_name = valid_name(old_name, "原数据库名")?;
    let new_name = valid_name(new_name, "新数据库名")?;

    if pool.kind() == DatabaseKind::Mysql {
        return Err(DatabaseError::InvalidInput(
            "MySQL 已移除 RENAME DATABASE。为避免丢失视图、触发器和存储过程，MiraiHub 不执行不安全的模拟迁移；请新建数据库后使用导出/导入迁移。"
                .to_owned(),
        ));
    }

    let statement = format!(
        "ALTER DATABASE {} RENAME TO {}",
        sql::quote_identifier(old_name, pool.kind()),
        sql::quote_identifier(new_name, pool.kind())
    );
    execute(pool, &statement).await
}

pub async fn drop_database(pool: &DatabasePool, name: &str) -> DatabaseResult<()> {
    let name = valid_name(name, "数据库名")?;
    let statement = format!("DROP DATABASE {}", sql::quote_identifier(name, pool.kind()));
    execute(pool, &statement).await
}

pub async fn rename_object(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
    new_name: &str,
    kind: DatabaseObjectKind,
    identity: &str,
) -> DatabaseResult<()> {
    let schema = valid_name(schema, "schema")?;
    let name = valid_name(name, "对象名")?;
    let new_name = valid_name(new_name, "新对象名")?;
    let dialect = pool.kind();
    let target = sql::qualified_name(schema, name, dialect);
    let new_identifier = sql::quote_identifier(new_name, dialect);

    let statement = match (dialect, kind) {
        (DatabaseKind::Mysql, DatabaseObjectKind::Table | DatabaseObjectKind::View) => format!(
            "RENAME TABLE {target} TO {}",
            sql::qualified_name(schema, new_name, dialect)
        ),
        (DatabaseKind::Postgresql, DatabaseObjectKind::Table) => {
            format!("ALTER TABLE {target} RENAME TO {new_identifier}")
        }
        (DatabaseKind::Postgresql, DatabaseObjectKind::View) => {
            format!("ALTER VIEW {target} RENAME TO {new_identifier}")
        }
        (DatabaseKind::Postgresql, DatabaseObjectKind::Procedure) => format!(
            "ALTER PROCEDURE {target}({}) RENAME TO {new_identifier}",
            valid_identity(identity)?
        ),
        (DatabaseKind::Postgresql, DatabaseObjectKind::Function) => format!(
            "ALTER FUNCTION {target}({}) RENAME TO {new_identifier}",
            valid_identity(identity)?
        ),
        (DatabaseKind::Mysql, DatabaseObjectKind::Procedure | DatabaseObjectKind::Function) => {
            return Err(DatabaseError::InvalidInput(
                "MySQL 不支持直接重命名存储过程或函数；请打开 DDL，修改名称后重新创建。".to_owned(),
            ))
        }
    };

    execute(pool, &statement).await
}

pub async fn drop_object(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
    kind: DatabaseObjectKind,
    identity: &str,
) -> DatabaseResult<()> {
    let schema = valid_name(schema, "schema")?;
    let name = valid_name(name, "对象名")?;
    let dialect = pool.kind();
    let target = sql::qualified_name(schema, name, dialect);
    let statement = match kind {
        DatabaseObjectKind::Table => format!("DROP TABLE {target}"),
        DatabaseObjectKind::View => format!("DROP VIEW {target}"),
        DatabaseObjectKind::Procedure => {
            if dialect == DatabaseKind::Postgresql {
                format!("DROP PROCEDURE {target}({})", valid_identity(identity)?)
            } else {
                format!("DROP PROCEDURE {target}")
            }
        }
        DatabaseObjectKind::Function => {
            if dialect == DatabaseKind::Postgresql {
                format!("DROP FUNCTION {target}({})", valid_identity(identity)?)
            } else {
                format!("DROP FUNCTION {target}")
            }
        }
    };

    execute(pool, &statement).await
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

/// PostgreSQL 的 identity arguments 由系统目录产生，但 IPC 参数仍可能被篡改；
/// 禁止能结束当前 DDL 或开启注释的标记，再用于 ALTER / DROP 的签名定位。
fn valid_identity(identity: &str) -> DatabaseResult<&str> {
    if identity.contains(';')
        || identity.contains("--")
        || identity.contains("/*")
        || identity.contains("*/")
        || identity.chars().any(char::is_control)
    {
        return Err(DatabaseError::InvalidInput("例程签名不合法".to_owned()));
    }
    Ok(identity.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_injected_routine_identity() {
        assert!(valid_identity("int); DROP TABLE users; --").is_err());
        assert_eq!(valid_identity("integer, text").unwrap(), "integer, text");
    }

    #[test]
    fn rejects_control_characters_in_names() {
        assert!(valid_name("users\nDROP", "对象名").is_err());
    }
}
