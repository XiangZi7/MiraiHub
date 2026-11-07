//! SQLite 元数据读取。
//!
//! SQLite 没有 information_schema，结构信息来自 `sqlite_master` 与
//! `pragma_table_info / pragma_index_list / pragma_foreign_key_list` 表值函数。
//! 一个文件只有一个可用库，schema 固定为 `main`。

use std::collections::BTreeMap;

use sqlx::sqlite::SqlitePool;
use sqlx::Row;

use super::error::{DatabaseError, DatabaseResult};
use super::models::{
    DatabaseColumn, DatabaseForeignKey, DatabaseIndex, DatabaseIndexPart, DatabaseObject,
    DatabaseObjectKind,
};

/// SQLite 会话唯一的库名。
pub const SQLITE_SCHEMA: &str = "main";

/// 列出表与视图，跳过 `sqlite_` 开头的内部表。
pub async fn list_objects(pool: &SqlitePool) -> DatabaseResult<Vec<DatabaseObject>> {
    let rows = sqlx::query(
        "SELECT name, type FROM sqlite_master \
         WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;
    rows.iter()
        .map(|row| {
            let kind: String = row.try_get("type").map_err(DatabaseError::Query)?;
            Ok(DatabaseObject {
                schema: SQLITE_SCHEMA.to_owned(),
                name: row.try_get("name").map_err(DatabaseError::Query)?,
                kind: if kind == "view" {
                    DatabaseObjectKind::View
                } else {
                    DatabaseObjectKind::Table
                },
                identity: String::new(),
                row_estimate: None,
                comment: None,
                created_at: None,
                updated_at: None,
            })
        })
        .collect()
}

/// 读取列定义；整型主键在 SQLite 中即 rowid 别名，视为自增。
pub async fn describe(pool: &SqlitePool, name: &str) -> DatabaseResult<Vec<DatabaseColumn>> {
    let rows = sqlx::query(
        "SELECT cid, name, type, \"notnull\", dflt_value, pk FROM pragma_table_info(?)",
    )
    .bind(name)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;
    let pk_count = rows
        .iter()
        .filter(|row| row.try_get::<i64, _>("pk").unwrap_or(0) > 0)
        .count();
    rows.iter()
        .map(|row| {
            let data_type: String = row.try_get("type").unwrap_or_default();
            let primary_key = row.try_get::<i64, _>("pk").unwrap_or(0) > 0;
            Ok(DatabaseColumn {
                name: row.try_get("name").map_err(DatabaseError::Query)?,
                auto_increment: primary_key
                    && pk_count == 1
                    && data_type.eq_ignore_ascii_case("INTEGER"),
                data_type,
                nullable: row.try_get::<i64, _>("notnull").unwrap_or(0) == 0 && !primary_key,
                default_value: row.try_get("dflt_value").unwrap_or(None),
                ordinal: row.try_get::<i64, _>("cid").unwrap_or(0) as i32 + 1,
                primary_key,
                comment: None,
                charset: None,
                collation: None,
                on_update_current_timestamp: false,
                default_is_expression: false,
                generated_expression: None,
                generated_stored: false,
            })
        })
        .collect()
}

fn plain_index_parts(columns: &[String]) -> Vec<DatabaseIndexPart> {
    columns
        .iter()
        .map(|column| DatabaseIndexPart {
            column: column.clone(),
            sub_part: None,
            descending: false,
            expression: false,
            included: false,
        })
        .collect()
}

/// 读取索引（含由 PRIMARY KEY / UNIQUE 约束自动生成的索引）。
pub async fn indexes(pool: &SqlitePool, name: &str) -> DatabaseResult<Vec<DatabaseIndex>> {
    let list = sqlx::query("SELECT name, \"unique\", origin FROM pragma_index_list(?)")
        .bind(name)
        .fetch_all(pool)
        .await
        .map_err(DatabaseError::Query)?;
    let mut result = Vec::new();
    for row in &list {
        let index_name: String = row.try_get("name").map_err(DatabaseError::Query)?;
        let columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
                .bind(&index_name)
                .fetch_all(pool)
                .await
                .map_err(DatabaseError::Query)?;
        let origin: String = row.try_get("origin").unwrap_or_default();
        result.push(DatabaseIndex {
            name: index_name,
            parts: plain_index_parts(&columns),
            columns,
            unique: row.try_get::<i64, _>("unique").unwrap_or(0) == 1,
            primary: origin == "pk",
            sub_part: None,
            index_type: None,
            comment: None,
            predicate: None,
            constraint_backed: false,
        });
    }
    // rowid 整型主键没有物理索引，从列信息补一条主键索引，供网格编辑定位行。
    if !result.iter().any(|index| index.primary) {
        let columns: Vec<String> = describe(pool, name)
            .await?
            .into_iter()
            .filter(|column| column.primary_key)
            .map(|column| column.name)
            .collect();
        if !columns.is_empty() {
            result.insert(
                0,
                DatabaseIndex {
                    name: "PRIMARY".to_owned(),
                    parts: plain_index_parts(&columns),
                    columns,
                    unique: true,
                    primary: true,
                    sub_part: None,
                    index_type: None,
                    comment: None,
                    predicate: None,
                    constraint_backed: false,
                },
            );
        }
    }
    Ok(result)
}

/// 读取外键；同一 id 的多行合并为一个复合外键。
pub async fn foreign_keys(
    pool: &SqlitePool,
    name: &str,
) -> DatabaseResult<Vec<DatabaseForeignKey>> {
    let rows = sqlx::query("SELECT id, seq, \"table\", \"from\", \"to\", on_update, on_delete FROM pragma_foreign_key_list(?) ORDER BY id, seq")
        .bind(name)
        .fetch_all(pool)
        .await
        .map_err(DatabaseError::Query)?;
    let mut grouped: BTreeMap<i64, DatabaseForeignKey> = BTreeMap::new();
    for row in &rows {
        let id: i64 = row.try_get("id").unwrap_or(0);
        let entry = grouped.entry(id).or_insert_with(|| DatabaseForeignKey {
            name: format!("fk_{name}_{id}"),
            columns: Vec::new(),
            referenced_schema: SQLITE_SCHEMA.to_owned(),
            referenced_table: row.try_get("table").unwrap_or_default(),
            referenced_columns: Vec::new(),
            update_rule: row.try_get("on_update").unwrap_or_default(),
            delete_rule: row.try_get("on_delete").unwrap_or_default(),
        });
        entry.columns.push(row.try_get("from").unwrap_or_default());
        entry.referenced_columns.push(
            row.try_get::<Option<String>, _>("to")
                .unwrap_or(None)
                .unwrap_or_default(),
        );
    }
    Ok(grouped.into_values().collect())
}

/// 建表 / 建视图语句直接取 `sqlite_master.sql`，并附上手写索引。
pub async fn ddl(pool: &SqlitePool, name: &str) -> DatabaseResult<String> {
    let statements: Vec<Option<String>> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE tbl_name = ? AND sql IS NOT NULL \
         ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 0 ELSE 1 END, name",
    )
    .bind(name)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;
    Ok(statements
        .into_iter()
        .flatten()
        .map(|statement| format!("{statement};"))
        .collect::<Vec<_>>()
        .join("\n\n"))
}

/// 补全用的“表 → 字段”对。
pub async fn table_columns(pool: &SqlitePool) -> DatabaseResult<Vec<(String, String)>> {
    sqlx::query_as(
        "SELECT m.name, p.name FROM sqlite_master m JOIN pragma_table_info(m.name) p \
         WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid",
    )
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    /// 用内存库验证表、列、索引、外键读取。
    #[tokio::test]
    async fn reads_schema_from_memory_database() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE);
             CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), total REAL);
             CREATE INDEX idx_orders_user ON orders(user_id);",
        )
        .execute(&pool)
        .await
        .unwrap();

        let objects = list_objects(&pool).await.unwrap();
        assert_eq!(objects.len(), 2);
        let columns = describe(&pool, "users").await.unwrap();
        assert!(columns[0].primary_key && columns[0].auto_increment);
        assert!(!columns[1].nullable);
        let indexes = indexes(&pool, "orders").await.unwrap();
        assert!(indexes.iter().any(|index| index.primary));
        assert!(indexes.iter().any(|index| index.name == "idx_orders_user"));
        let keys = foreign_keys(&pool, "orders").await.unwrap();
        assert_eq!(keys[0].referenced_table, "users");
        assert!(ddl(&pool, "orders").await.unwrap().contains("CREATE INDEX"));
        assert_eq!(table_columns(&pool).await.unwrap().len(), 5);
    }
}
