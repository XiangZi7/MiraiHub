//! 表设计器的 DDL 执行。
//!
//! 前端已经把语句逐条拆好（触发器体、函数体里的分号不能再交给切分器），
//! 这里按顺序跑在同一条连接上。PostgreSQL / SQLite 的 DDL 可以回滚，
//! 整批包进事务：任何一条失败就全部撤销，表不会停在改了一半的状态。
//! MySQL 的 DDL 会隐式提交，只能逐条执行并报告停在哪一条。

use sqlx::Executor;

use super::error::DatabaseResult;
use super::manager::{DatabaseConnection, DatabaseManager};
use super::models::DatabaseDdlExecution;

async fn run(connection: &mut DatabaseConnection, statement: &str) -> Result<(), sqlx::Error> {
    match connection {
        DatabaseConnection::Mysql(conn) => (&mut **conn).execute(sqlx::raw_sql(statement)).await.map(|_| ()),
        DatabaseConnection::Postgresql(conn) => {
            (&mut **conn).execute(sqlx::raw_sql(statement)).await.map(|_| ())
        }
        DatabaseConnection::Sqlite(conn) => (&mut **conn).execute(sqlx::raw_sql(statement)).await.map(|_| ()),
    }
}

pub async fn execute_ddl(
    manager: &DatabaseManager,
    session_id: &str,
    statements: &[String],
) -> DatabaseResult<DatabaseDdlExecution> {
    let pool = manager.pool(session_id).await?;
    let mut connection = pool.acquire().await?;
    let transactional = !matches!(connection, DatabaseConnection::Mysql(_));
    let statements: Vec<&str> = statements
        .iter()
        .map(|statement| statement.trim())
        .filter(|statement| !statement.is_empty())
        .collect();

    if transactional {
        run(&mut connection, "BEGIN")
            .await
            .map_err(super::error::DatabaseError::Query)?;
    }
    for (index, statement) in statements.iter().enumerate() {
        if let Err(error) = run(&mut connection, statement).await {
            let rolled_back = transactional && run(&mut connection, "ROLLBACK").await.is_ok();
            if transactional && !rolled_back {
                // 回滚都失败的连接状态不可信，不放回池里。
                if let DatabaseConnection::Postgresql(conn) = connection {
                    let _ = conn.detach();
                }
            }
            return Ok(DatabaseDdlExecution {
                transactional,
                executed: index,
                failed_index: Some(index),
                failed_statement: Some((*statement).to_owned()),
                error: Some(error.to_string()),
                rolled_back,
            });
        }
    }
    if transactional {
        if let Err(error) = run(&mut connection, "COMMIT").await {
            let _ = run(&mut connection, "ROLLBACK").await;
            return Ok(DatabaseDdlExecution {
                transactional,
                executed: statements.len(),
                failed_index: None,
                failed_statement: Some("COMMIT".to_owned()),
                error: Some(error.to_string()),
                rolled_back: true,
            });
        }
    }
    Ok(DatabaseDdlExecution {
        transactional,
        executed: statements.len(),
        failed_index: None,
        failed_statement: None,
        error: None,
        rolled_back: false,
    })
}
