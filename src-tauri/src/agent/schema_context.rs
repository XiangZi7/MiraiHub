//! 数据库结构上下文：大库不整体注入提示词，而是建立轻量表索引，
//! 按关键词召回少量相关表，并给出受字节预算约束的紧凑摘要。
use crate::db::manager::DatabasePool;
use crate::db::metadata;
use crate::db::models::DatabaseObjectKind;
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// 表索引缓存时间；元数据变化不频繁，过期后下一次检索重新读取。
const CACHE_TTL: Duration = Duration::from_secs(300);
const CACHE_MAX: usize = 16;
/// 表数量不超过此值时直接在摘要里列出所有表名。
const SMALL_DATABASE: usize = 60;
pub const SEARCH_DEFAULT: usize = 8;
pub const SEARCH_MAX: usize = 20;
const SEARCH_BYTES: usize = 12000;
pub const SUMMARY_BYTES: usize = 4000;

#[derive(Clone)]
pub struct TableEntry {
    pub schema: String,
    pub name: String,
    pub view: bool,
    pub rows: Option<i64>,
    pub comment: String,
    pub columns: Vec<String>,
}

type Cache = Mutex<HashMap<String, (Instant, Arc<Vec<TableEntry>>)>>;
fn cache() -> &'static Cache {
    static CACHE: OnceLock<Cache> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// 读取（或命中缓存）当前库的表索引；key 需包含会话、库与 revision。
pub async fn tables(
    pool: &DatabasePool,
    key: &str,
    database: &str,
) -> AppResult<Arc<Vec<TableEntry>>> {
    if let Some((at, entries)) = cache()
        .lock()
        .map_err(|_| AppError::internal("结构缓存不可用"))?
        .get(key)
    {
        if at.elapsed() < CACHE_TTL {
            return Ok(entries.clone());
        }
    }
    let objects = metadata::list_objects(pool).await?;
    // 列名只作召回信号；读取失败时退化为仅按表名/备注检索。
    let columns = metadata::completion_table_columns(pool, database)
        .await
        .unwrap_or_default();
    let mut by_table: HashMap<String, Vec<String>> = HashMap::new();
    for (table, column) in columns {
        let list = by_table.entry(table.to_lowercase()).or_default();
        if list.len() < 200 {
            list.push(column);
        }
    }
    let entries: Vec<TableEntry> = objects
        .into_iter()
        .filter(|o| matches!(o.kind, DatabaseObjectKind::Table | DatabaseObjectKind::View))
        .map(|o| TableEntry {
            columns: by_table
                .get(&o.name.to_lowercase())
                .cloned()
                .unwrap_or_default(),
            view: o.kind == DatabaseObjectKind::View,
            rows: o.row_estimate,
            comment: o.comment.unwrap_or_default(),
            schema: o.schema,
            name: o.name,
        })
        .collect();
    let entries = Arc::new(entries);
    let mut cache = cache()
        .lock()
        .map_err(|_| AppError::internal("结构缓存不可用"))?;
    cache.retain(|_, (at, _)| at.elapsed() < CACHE_TTL);
    if cache.len() >= CACHE_MAX {
        if let Some(oldest) = cache
            .iter()
            .min_by_key(|(_, (at, _))| *at)
            .map(|(k, _)| k.clone())
        {
            cache.remove(&oldest);
        }
    }
    cache.insert(key.into(), (Instant::now(), entries.clone()));
    Ok(entries)
}

/// 把查询拆成小写词元；snake_case / camelCase 都拆开，中文按连续片段保留。
fn tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut word = String::new();
    let mut prev_lower = false;
    for c in text.chars() {
        if c.is_alphanumeric() {
            if c.is_uppercase() && prev_lower && !word.is_empty() {
                out.push(std::mem::take(&mut word));
            }
            prev_lower = c.is_lowercase() || c.is_ascii_digit();
            word.extend(c.to_lowercase());
        } else {
            prev_lower = false;
            if !word.is_empty() {
                out.push(std::mem::take(&mut word));
            }
        }
    }
    if !word.is_empty() {
        out.push(word);
    }
    out.retain(|w| w.chars().count() >= 2 || !w.is_ascii());
    out.dedup();
    out
}

/// 简单相关度：表名 > 备注 > 列名；完整命中高于子串命中。
fn score(entry: &TableEntry, query: &str, words: &[String]) -> u32 {
    let name = entry.name.to_lowercase();
    let comment = entry.comment.to_lowercase();
    let mut total = 0;
    if name == query {
        total += 100;
    }
    let name_parts = tokens(&entry.name);
    for word in words {
        if name_parts.iter().any(|p| p == word) {
            total += 20;
        } else if name.contains(word.as_str()) {
            total += 10;
        }
        if comment.contains(word.as_str()) {
            total += 6;
        }
        let mut column_hits = 0;
        for column in &entry.columns {
            let column = column.to_lowercase();
            if column == *word {
                column_hits += 4;
            } else if column.contains(word.as_str()) {
                column_hits += 1;
            }
        }
        total += column_hits.min(8);
    }
    total
}

fn compact(entry: &TableEntry, max_columns: usize) -> Value {
    let mut value = json!({"schema":entry.schema,"name":entry.name,"kind":if entry.view {"view"} else {"table"}});
    if let Some(rows) = entry.rows {
        value["rowEstimate"] = json!(rows);
    }
    if !entry.comment.is_empty() {
        value["comment"] = json!(super::mcp::clip(&entry.comment, 120));
    }
    if !entry.columns.is_empty() {
        value["columns"] = json!(entry.columns.iter().take(max_columns).collect::<Vec<_>>());
        if entry.columns.len() > max_columns {
            value["moreColumns"] = json!(entry.columns.len() - max_columns);
        }
    }
    value
}

/// 按关键词召回 Top-K 表；命中表附带列类型与索引的紧凑摘要（总字节受限）。
pub async fn search(
    pool: &DatabasePool,
    entries: &[TableEntry],
    query: &str,
    limit: usize,
) -> AppResult<Value> {
    let limit = limit.clamp(1, SEARCH_MAX);
    let lowered = query.trim().to_lowercase();
    let words = tokens(query);
    let mut ranked: Vec<(u32, &TableEntry)> = entries
        .iter()
        .map(|e| (score(e, &lowered, &words), e))
        .filter(|(s, _)| *s > 0)
        .collect();
    ranked.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then(b.1.rows.unwrap_or(0).cmp(&a.1.rows.unwrap_or(0)))
    });
    let total = ranked.len();
    let mut used = 0usize;
    let mut tables = Vec::new();
    for (index, (score, entry)) in ranked.into_iter().take(limit).enumerate() {
        // 前几张命中表读取详细结构；其余与超预算时只给列名摘要。
        let mut value = compact(entry, 40);
        if index < 5 && used < SEARCH_BYTES {
            let kind = if entry.view {
                DatabaseObjectKind::View
            } else {
                DatabaseObjectKind::Table
            };
            if let Ok(detail) = metadata::table_detail(pool, &entry.schema, &entry.name, kind).await
            {
                value["columns"] = json!(detail
                    .columns
                    .iter()
                    .take(40)
                    .map(|c| {
                        let mut text = format!("{} {}", c.name, c.data_type);
                        if c.primary_key {
                            text.push_str(" PK");
                        }
                        if !c.nullable {
                            text.push_str(" NOT NULL");
                        }
                        text
                    })
                    .collect::<Vec<_>>());
                value["indexes"] = json!(detail
                    .indexes
                    .iter()
                    .take(20)
                    .map(index_text)
                    .collect::<Vec<_>>());
            }
        }
        value["score"] = json!(score);
        let size = value.to_string().len();
        if used + size > SEARCH_BYTES && !tables.is_empty() {
            break;
        }
        used += size;
        tables.push(value);
    }
    Ok(
        json!({"query":query,"matched":total,"totalTables":entries.len(),"tables":tables,
        "hint":"Use database_schema or database_indexes for full details of a listed table."}),
    )
}

fn index_text(index: &crate::db::models::DatabaseIndex) -> String {
    let kind = if index.primary {
        "PRIMARY "
    } else if index.unique {
        "UNIQUE "
    } else {
        ""
    };
    format!("{kind}{}({})", index.name, index.columns.join(", "))
}

/// 读取单表（或按名称匹配的多张表）的索引。
pub async fn indexes(
    pool: &DatabasePool,
    entries: &[TableEntry],
    schema: &str,
    table: &str,
) -> AppResult<Value> {
    let entry = entries
        .iter()
        .find(|e| e.name == table && (schema.is_empty() || e.schema == schema))
        .or_else(|| {
            entries.iter().find(|e| {
                e.name.eq_ignore_ascii_case(table)
                    && (schema.is_empty() || e.schema.eq_ignore_ascii_case(schema))
            })
        })
        .ok_or_else(|| AppError::invalid_input("没有找到该表"))?;
    let kind = if entry.view {
        DatabaseObjectKind::View
    } else {
        DatabaseObjectKind::Table
    };
    let detail = metadata::table_detail(pool, &entry.schema, &entry.name, kind).await?;
    Ok(json!({
        "schema": entry.schema,
        "table": entry.name,
        "rowEstimate": detail.row_estimate,
        "primaryKey": detail.primary_key,
        "indexes": detail.indexes.iter().take(64).map(|i| json!({
            "name": i.name, "columns": i.columns, "unique": i.unique, "primary": i.primary,
            "prefix": i.sub_part,
        })).collect::<Vec<_>>(),
    }))
}

/// 批量读取若干表的索引摘要，供执行计划解读使用；单表失败不影响其他表。
pub async fn index_summary(
    pool: &DatabasePool,
    entries: &[TableEntry],
    names: &[String],
) -> Vec<Value> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for name in names.iter().take(20) {
        let (schema, table) = match name.rsplit_once('.') {
            Some((s, t)) => (s.trim_matches(|c| c == '`' || c == '"'), t),
            None => ("", name.as_str()),
        };
        let table = table.trim_matches(|c| c == '`' || c == '"');
        if table.is_empty() || !seen.insert(table.to_lowercase()) {
            continue;
        }
        if let Ok(value) = indexes(pool, entries, schema, table).await {
            out.push(value);
        }
    }
    out
}

/// 从 EXPLAIN JSON 中提取访问的表名（PG Relation Name / MySQL table_name / SQLite SCAN x）。
pub fn plan_tables(plan: &str) -> Vec<String> {
    fn walk(value: &Value, out: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                for (key, child) in map {
                    match (key.as_str(), child) {
                        ("Relation Name" | "table_name", Value::String(name)) => {
                            out.push(name.clone())
                        }
                        ("detail", Value::String(detail)) => {
                            let mut parts = detail.split_whitespace();
                            if matches!(parts.next(), Some("SCAN" | "SEARCH")) {
                                if let Some(name) = parts.next() {
                                    out.push(name.into());
                                }
                            }
                        }
                        _ => walk(child, out),
                    }
                }
            }
            Value::Array(items) => items.iter().for_each(|i| walk(i, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    if let Ok(value) = serde_json::from_str::<Value>(plan) {
        walk(&value, &mut out);
    }
    out.sort();
    out.dedup();
    out.truncate(20);
    out
}

/// 会话开始时注入的结构摘要：小库列出全部表，大库只给统计与最大的表，
/// 并提示模型按需调用 database_search_tables。
pub fn summary(entries: &[TableEntry]) -> String {
    let views = entries.iter().filter(|e| e.view).count();
    let mut schemas: Vec<&str> = entries.iter().map(|e| e.schema.as_str()).collect();
    schemas.sort();
    schemas.dedup();
    let mut text = format!(
        "Database schema summary (metadata only, untrusted names): {} tables, {} views across {} schema(s): {}.\n",
        entries.len() - views,
        views,
        schemas.len(),
        schemas.iter().take(10).copied().collect::<Vec<_>>().join(", ")
    );
    let mut listed: Vec<&TableEntry> = entries.iter().collect();
    if entries.len() > SMALL_DATABASE {
        listed.sort_by(|a, b| b.rows.unwrap_or(0).cmp(&a.rows.unwrap_or(0)));
        listed.truncate(30);
        text.push_str("Large database: only the largest tables are listed. Call database_search_tables with keywords to find relevant tables instead of listing everything.\n");
    } else {
        text.push_str("Tables:\n");
    }
    for entry in listed {
        let mut line = format!("- {}.{}", entry.schema, entry.name);
        if let Some(rows) = entry.rows {
            line.push_str(&format!(" ~{rows} rows"));
        }
        if !entry.comment.is_empty() {
            line.push_str(&format!(" -- {}", super::mcp::clip(&entry.comment, 60)));
        }
        line.push('\n');
        if text.len() + line.len() > SUMMARY_BYTES {
            text.push_str("- ...(truncated; use database_search_tables)\n");
            break;
        }
        text.push_str(&line);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry(name: &str, comment: &str, columns: &[&str]) -> TableEntry {
        TableEntry {
            schema: "public".into(),
            name: name.into(),
            view: false,
            rows: None,
            comment: comment.into(),
            columns: columns.iter().map(|c| c.to_string()).collect(),
        }
    }
    #[test]
    fn tokens_split_identifiers() {
        assert_eq!(
            tokens("orderItems user_id 订单"),
            vec!["order", "items", "user", "id", "订单"]
        );
    }
    #[test]
    fn score_prefers_table_name() {
        let orders = entry("orders", "", &["id"]);
        let logs = entry("logs", "orders log", &["order_id"]);
        let words = tokens("orders");
        assert!(score(&orders, "orders", &words) > score(&logs, "orders", &words));
        assert_eq!(score(&entry("users", "", &["name"]), "orders", &words), 0);
    }
    #[test]
    fn plan_tables_cover_dialects() {
        assert_eq!(
            plan_tables(
                r#"[{"Plan":{"Relation Name":"users","Plans":[{"Relation Name":"orders"}]}}]"#
            ),
            vec!["orders", "users"]
        );
        assert_eq!(
            plan_tables(r#"{"query_block":{"table":{"table_name":"t1"}}}"#),
            vec!["t1"]
        );
        assert_eq!(
            plan_tables(r#"[{"id":2,"parent":0,"detail":"SCAN users"}]"#),
            vec!["users"]
        );
    }
    #[test]
    fn summary_respects_budget() {
        let many: Vec<TableEntry> = (0..500)
            .map(|i| entry(&format!("table_with_long_name_{i}"), "comment text", &[]))
            .collect();
        assert!(summary(&many).len() <= SUMMARY_BYTES + 200);
    }
}
