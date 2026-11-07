//! 表设计器用到的附加结构：CHECK 约束、触发器与分区信息。
//!
//! 这些信息只有设计器和结构面板关心，读失败一律退回空值，不影响表详情的其余部分。
//! SQLite 的设计器只给 SQL 模板，这里不读。

use sqlx::Row;

use super::error::{DatabaseError, DatabaseResult};
use super::manager::DatabasePool;
use super::metadata::mysql_optional_metadata_text;
use super::models::{DatabaseCheckConstraint, DatabasePartition, DatabasePartitionInfo, DatabaseTrigger};

/// 去掉整体包住表达式的一层括号：`(a > 0)` -> `a > 0`，`(a) + (b)` 保持不变。
fn strip_outer_parens(text: &str) -> String {
    let mut current = text.trim();
    loop {
        if !(current.starts_with('(') && current.ends_with(')')) {
            return current.to_owned();
        }
        let mut depth = 0i32;
        let mut quote: Option<char> = None;
        let mut wraps = true;
        let last = current.len() - 1;
        for (index, ch) in current.char_indices() {
            if let Some(q) = quote {
                if ch == q {
                    quote = None;
                }
                continue;
            }
            match ch {
                '\'' | '"' | '`' => quote = Some(ch),
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 && index != last {
                        wraps = false;
                        break;
                    }
                }
                _ => {}
            }
        }
        if !wraps {
            return current.to_owned();
        }
        current = current[1..last].trim();
    }
}

pub async fn list_checks(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Vec<DatabaseCheckConstraint>> {
    match pool {
        DatabasePool::Mysql(pool) => {
            // MySQL 8.0.16 之前没有 CHECK_CONSTRAINTS，查询报错时由调用方退回空列表。
            let rows = sqlx::query(
                r#"
                SELECT CAST(cc.CONSTRAINT_NAME AS CHAR) AS CONSTRAINT_NAME,
                       CAST(cc.CHECK_CLAUSE AS CHAR) AS CHECK_CLAUSE
                FROM information_schema.CHECK_CONSTRAINTS cc
                JOIN information_schema.TABLE_CONSTRAINTS tc
                  ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
                 AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
                WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'CHECK'
                ORDER BY cc.CONSTRAINT_NAME
                "#,
            )
            .bind(schema)
            .bind(name)
            .fetch_all(pool)
            .await
            .map_err(DatabaseError::Query)?;
            rows.iter()
                .map(|row| {
                    Ok(DatabaseCheckConstraint {
                        name: mysql_optional_metadata_text(row, "CONSTRAINT_NAME")?
                            .unwrap_or_default(),
                        expression: strip_outer_parens(
                            &mysql_optional_metadata_text(row, "CHECK_CLAUSE")?
                                .unwrap_or_default(),
                        ),
                    })
                })
                .collect()
        }
        DatabasePool::Postgresql(pool) => {
            let rows = sqlx::query(
                r#"
                SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS definition
                FROM pg_constraint con
                JOIN pg_class c ON c.oid = con.conrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE con.contype = 'c' AND n.nspname = $1 AND c.relname = $2
                ORDER BY con.conname
                "#,
            )
            .bind(schema)
            .bind(name)
            .fetch_all(pool)
            .await
            .map_err(DatabaseError::Query)?;
            Ok(rows
                .iter()
                .map(|row| {
                    let definition: String = row.try_get("definition").unwrap_or_default();
                    let body = definition.trim();
                    let body = body.strip_prefix("CHECK").unwrap_or(body);
                    let body = body.trim().trim_end_matches("NOT VALID").trim();
                    DatabaseCheckConstraint {
                        name: row.try_get("name").unwrap_or_default(),
                        expression: strip_outer_parens(body),
                    }
                })
                .collect())
        }
        DatabasePool::Sqlite(_) => Ok(Vec::new()),
    }
}

pub async fn list_triggers(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Vec<DatabaseTrigger>> {
    match pool {
        DatabasePool::Mysql(pool) => {
            let rows = sqlx::query(
                r#"
                SELECT CAST(TRIGGER_NAME AS CHAR) AS TRIGGER_NAME,
                       CAST(ACTION_TIMING AS CHAR) AS ACTION_TIMING,
                       CAST(EVENT_MANIPULATION AS CHAR) AS EVENT_MANIPULATION,
                       CAST(ACTION_STATEMENT AS CHAR) AS ACTION_STATEMENT,
                       CAST(ACTION_ORIENTATION AS CHAR) AS ACTION_ORIENTATION
                FROM information_schema.TRIGGERS
                WHERE EVENT_OBJECT_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?
                ORDER BY ACTION_TIMING, EVENT_MANIPULATION, ACTION_ORDER
                "#,
            )
            .bind(schema)
            .bind(name)
            .fetch_all(pool)
            .await
            .map_err(DatabaseError::Query)?;
            rows.iter()
                .map(|row| {
                    let text = |column| -> DatabaseResult<String> {
                        Ok(mysql_optional_metadata_text(row, column)?.unwrap_or_default())
                    };
                    Ok(DatabaseTrigger {
                        name: text("TRIGGER_NAME")?,
                        timing: text("ACTION_TIMING")?,
                        events: vec![text("EVENT_MANIPULATION")?],
                        body: text("ACTION_STATEMENT")?,
                        function: String::new(),
                        level: text("ACTION_ORIENTATION")?,
                    })
                })
                .collect()
        }
        DatabasePool::Postgresql(pool) => {
            let rows = sqlx::query(
                r#"
                SELECT t.tgname AS name,
                       t.tgtype::int AS tgtype,
                       p.prosrc AS body,
                       quote_ident(pn.nspname) || '.' || quote_ident(p.proname) AS function
                FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_proc p ON p.oid = t.tgfoid
                JOIN pg_namespace pn ON pn.oid = p.pronamespace
                WHERE NOT t.tgisinternal AND n.nspname = $1 AND c.relname = $2
                ORDER BY t.tgname
                "#,
            )
            .bind(schema)
            .bind(name)
            .fetch_all(pool)
            .await
            .map_err(DatabaseError::Query)?;
            Ok(rows
                .iter()
                .map(|row| {
                    // tgtype 位：1 行级、2 BEFORE、64 INSTEAD OF、4 INSERT、8 DELETE、16 UPDATE、32 TRUNCATE
                    let kind: i32 = row.try_get("tgtype").unwrap_or(0);
                    let timing = if kind & 64 != 0 {
                        "INSTEAD OF"
                    } else if kind & 2 != 0 {
                        "BEFORE"
                    } else {
                        "AFTER"
                    };
                    let events = [(4, "INSERT"), (16, "UPDATE"), (8, "DELETE"), (32, "TRUNCATE")]
                        .into_iter()
                        .filter(|(bit, _)| kind & bit != 0)
                        .map(|(_, event)| event.to_owned())
                        .collect();
                    DatabaseTrigger {
                        name: row.try_get("name").unwrap_or_default(),
                        timing: timing.to_owned(),
                        events,
                        body: row.try_get("body").unwrap_or_default(),
                        function: row.try_get("function").unwrap_or_default(),
                        level: if kind & 1 != 0 { "ROW" } else { "STATEMENT" }.to_owned(),
                    }
                })
                .collect())
        }
        DatabasePool::Sqlite(_) => Ok(Vec::new()),
    }
}

pub async fn partition_info(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Option<DatabasePartitionInfo>> {
    match pool {
        DatabasePool::Mysql(pool) => {
            let rows = sqlx::query(
                r#"
                SELECT CAST(PARTITION_NAME AS CHAR) AS PARTITION_NAME,
                       CAST(PARTITION_METHOD AS CHAR) AS PARTITION_METHOD,
                       CAST(PARTITION_EXPRESSION AS CHAR) AS PARTITION_EXPRESSION,
                       CAST(PARTITION_DESCRIPTION AS CHAR) AS PARTITION_DESCRIPTION,
                       CAST(TABLE_ROWS AS SIGNED) AS TABLE_ROWS
                FROM information_schema.PARTITIONS
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND PARTITION_NAME IS NOT NULL
                ORDER BY PARTITION_ORDINAL_POSITION
                "#,
            )
            .bind(schema)
            .bind(name)
            .fetch_all(pool)
            .await
            .map_err(DatabaseError::Query)?;
            let Some(first) = rows.first() else {
                return Ok(None);
            };
            let method = mysql_optional_metadata_text(first, "PARTITION_METHOD")?.unwrap_or_default();
            let expression =
                mysql_optional_metadata_text(first, "PARTITION_EXPRESSION")?.unwrap_or_default();
            let partitions = rows
                .iter()
                .map(|row| {
                    Ok(DatabasePartition {
                        name: mysql_optional_metadata_text(row, "PARTITION_NAME")?
                            .unwrap_or_default(),
                        description: mysql_optional_metadata_text(row, "PARTITION_DESCRIPTION")?
                            .unwrap_or_default(),
                        rows: row.try_get::<Option<i64>, _>("TABLE_ROWS").unwrap_or(None),
                    })
                })
                .collect::<DatabaseResult<Vec<_>>>()?;
            Ok(Some(DatabasePartitionInfo {
                method,
                expression,
                partitions,
            }))
        }
        DatabasePool::Postgresql(pool) => {
            let key = sqlx::query(
                r#"
                SELECT pg_get_partkeydef(c.oid) AS key
                FROM pg_partitioned_table pt
                JOIN pg_class c ON c.oid = pt.partrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = $1 AND c.relname = $2
                "#,
            )
            .bind(schema)
            .bind(name)
            .fetch_optional(pool)
            .await
            .map_err(DatabaseError::Query)?;
            let Some(key) = key else {
                return Ok(None);
            };
            let key: String = key.try_get("key").unwrap_or_default();
            let (method, expression) = match key.split_once(' ') {
                Some((method, expression)) => (method.to_owned(), strip_outer_parens(expression)),
                None => (key.clone(), String::new()),
            };
            let rows = sqlx::query(
                r#"
                SELECT child.relname AS name,
                       pg_get_expr(child.relpartbound, child.oid) AS bound,
                       child.reltuples::bigint AS estimate
                FROM pg_inherits i
                JOIN pg_class parent ON parent.oid = i.inhparent
                JOIN pg_namespace n ON n.oid = parent.relnamespace
                JOIN pg_class child ON child.oid = i.inhrelid
                WHERE n.nspname = $1 AND parent.relname = $2
                ORDER BY child.relname
                "#,
            )
            .bind(schema)
            .bind(name)
            .fetch_all(pool)
            .await
            .map_err(DatabaseError::Query)?;
            Ok(Some(DatabasePartitionInfo {
                method,
                expression,
                partitions: rows
                    .iter()
                    .map(|row| DatabasePartition {
                        name: row.try_get("name").unwrap_or_default(),
                        description: row.try_get("bound").unwrap_or_default(),
                        rows: row
                            .try_get::<Option<i64>, _>("estimate")
                            .unwrap_or(None)
                            .filter(|value| *value >= 0),
                    })
                    .collect(),
            }))
        }
        DatabasePool::Sqlite(_) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::strip_outer_parens;

    #[test]
    fn strips_only_wrapping_parens() {
        assert_eq!(strip_outer_parens("((`age` > 0))"), "`age` > 0");
        assert_eq!(strip_outer_parens("(a) + (b)"), "(a) + (b)");
        assert_eq!(strip_outer_parens("(x = ')')"), "x = ')'");
    }
}
