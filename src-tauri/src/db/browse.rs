//! 表数据分页浏览。
//!
//! 数据网格不走用户的 SQL，而是由这里按结构化请求拼语句：列名与表名统一
//! 转义，筛选值一律走绑定参数。多取一行判断"后面还有没有"，省掉一次 COUNT。

use std::collections::BTreeMap;

use super::error::{DatabaseError, DatabaseResult};
use super::manager::DatabasePool;
use super::metadata;
use super::models::{
    DatabaseKind, DatabaseRowPage, RowFilter, RowFilterOperator, RowPageRequest, RowSort,
};
use super::query;
use super::sql;

/// 单页上限。再多前端表格也渲染不动，翻页更合适。
const MAX_PAGE_SIZE: u32 = 5_000;

/// 逐个累积绑定参数，并按方言产出对应的占位符。
struct Binder {
    kind: DatabaseKind,
    values: Vec<Option<String>>,
}

impl Binder {
    fn new(kind: DatabaseKind) -> Self {
        Self {
            kind,
            values: Vec::new(),
        }
    }

    /// 登记一个值，返回它在 SQL 里的占位符。
    fn push(&mut self, value: Option<String>) -> String {
        self.values.push(value);
        match self.kind {
            DatabaseKind::Mysql => "?".to_owned(),
            DatabaseKind::Postgresql => format!("${}", self.values.len()),
        }
    }
}

pub async fn fetch_rows(
    pool: &DatabasePool,
    request: &RowPageRequest,
) -> DatabaseResult<DatabaseRowPage> {
    let schema = request.schema.trim();
    let table = request.table.trim();
    if table.is_empty() {
        return Err(DatabaseError::InvalidInput("表名不能为空".to_owned()));
    }

    let kind = pool.kind();
    let limit = request.limit.clamp(1, MAX_PAGE_SIZE);
    // PostgreSQL 的绑定参数默认是 text，与 int/timestamp 列比较会直接报类型错，
    // 所以要按列的真实类型给占位符加转型。MySQL 会隐式转换，拿到的是空表。
    let casts = if request.filters.is_empty() {
        BTreeMap::new()
    } else {
        metadata::column_cast_types(pool, schema, table)
            .await
            .unwrap_or_default()
    };

    let mut binder = Binder::new(kind);
    let where_clause = build_where(&request.filters, kind, &casts, &mut binder)?;
    let order_clause = build_order(request.sort.as_ref(), kind)?;

    // 多查一行用来判断还有没有下一页。
    let statement = format!(
        "SELECT * FROM {}{where_clause}{order_clause} LIMIT {} OFFSET {}",
        sql::qualified_name(schema, table, kind),
        limit as u64 + 1,
        request.offset
    );

    let started = std::time::Instant::now();
    let (columns, mut rows) = match pool {
        DatabasePool::Mysql(pool) => {
            let mut query = sqlx::query(&statement);
            for value in &binder.values {
                query = query.bind(value.clone());
            }
            let rows = query.fetch_all(pool).await.map_err(DatabaseError::Query)?;
            (
                rows.first().map(query::mysql_columns).unwrap_or_default(),
                rows.iter().map(query::decode_mysql_row).collect::<Vec<_>>(),
            )
        }
        DatabasePool::Postgresql(pool) => {
            let mut query = sqlx::query(&statement);
            for value in &binder.values {
                query = query.bind(value.clone());
            }
            let rows = query.fetch_all(pool).await.map_err(DatabaseError::Query)?;
            (
                rows.first()
                    .map(query::postgresql_columns)
                    .unwrap_or_default(),
                rows.iter()
                    .map(query::decode_postgresql_row)
                    .collect::<Vec<_>>(),
            )
        }
    };

    let has_more = rows.len() > limit as usize;
    rows.truncate(limit as usize);

    Ok(DatabaseRowPage {
        columns,
        rows,
        offset: request.offset,
        limit,
        has_more,
        elapsed_ms: query::elapsed_millis(started),
        sql: display_sql(&statement, &binder.values, kind),
    })
}

fn build_where(
    filters: &[RowFilter],
    kind: DatabaseKind,
    casts: &BTreeMap<String, String>,
    binder: &mut Binder,
) -> DatabaseResult<String> {
    let mut conditions = Vec::with_capacity(filters.len());

    for filter in filters {
        let column = filter.column.trim();
        ensure_identifier(column)?;
        let quoted = sql::quote_identifier(column, kind);

        let condition = match filter.operator {
            RowFilterOperator::IsNull => format!("{quoted} IS NULL"),
            RowFilterOperator::NotNull => format!("{quoted} IS NOT NULL"),
            RowFilterOperator::Contains | RowFilterOperator::StartsWith => {
                let pattern = if filter.operator == RowFilterOperator::Contains {
                    format!("%{}%", escape_like(&filter.value))
                } else {
                    format!("{}%", escape_like(&filter.value))
                };
                let placeholder = binder.push(Some(pattern));
                match kind {
                    // 文本化后比较，数值列也能用同一个筛选框；MySQL 默认排序规则already
                    // 大小写不敏感，PostgreSQL 需要显式 ILIKE。
                    DatabaseKind::Mysql => format!("CAST({quoted} AS CHAR) LIKE {placeholder}"),
                    DatabaseKind::Postgresql => format!("{quoted}::text ILIKE {placeholder}"),
                }
            }
            _ => {
                let operator = match filter.operator {
                    RowFilterOperator::Equals => "=",
                    RowFilterOperator::NotEquals => "<>",
                    RowFilterOperator::GreaterThan => ">",
                    RowFilterOperator::LessThan => "<",
                    _ => unreachable!("上面已经处理"),
                };
                let placeholder = binder.push(Some(filter.value.clone()));
                format!(
                    "{quoted} {operator} {}",
                    cast_placeholder(&placeholder, column, kind, casts)
                )
            }
        };

        conditions.push(condition);
    }

    if conditions.is_empty() {
        return Ok(String::new());
    }

    Ok(format!(" WHERE {}", conditions.join(" AND ")))
}

fn build_order(sort: Option<&RowSort>, kind: DatabaseKind) -> DatabaseResult<String> {
    let Some(sort) = sort else {
        return Ok(String::new());
    };

    let column = sort.column.trim();
    if column.is_empty() {
        return Ok(String::new());
    }
    ensure_identifier(column)?;

    Ok(format!(
        " ORDER BY {} {}",
        sql::quote_identifier(column, kind),
        if sort.descending { "DESC" } else { "ASC" }
    ))
}

/// PostgreSQL 下给占位符补上列的真实类型，其余方言原样返回。
pub(super) fn cast_placeholder(
    placeholder: &str,
    column: &str,
    kind: DatabaseKind,
    casts: &BTreeMap<String, String>,
) -> String {
    if kind != DatabaseKind::Postgresql {
        return placeholder.to_owned();
    }

    match casts.get(column) {
        Some(cast_type) => format!("{placeholder}::{cast_type}"),
        // 类型未知时退回 text：至少能和文本列比较，不会因为隐式转换失败整条报错。
        None => format!("{placeholder}::text"),
    }
}

/// LIKE 模式里的通配符要转义，否则用户输入的 `%` 会变成"匹配任意"。
fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// 标识符只做基本合法性检查；真正的注入防护靠 `quote_identifier` 的引号翻倍。
pub(super) fn ensure_identifier(name: &str) -> DatabaseResult<()> {
    if name.is_empty() {
        return Err(DatabaseError::InvalidInput("列名不能为空".to_owned()));
    }
    if name.chars().any(|c| c == '\0' || c.is_control()) {
        return Err(DatabaseError::InvalidInput(format!(
            "列名 {name:?} 含有非法字符"
        )));
    }

    Ok(())
}

/// 把占位符换成字面量，生成可以直接粘到编辑器里重跑的 SQL。仅用于展示。
pub(super) fn display_sql(
    statement: &str,
    values: &[Option<String>],
    kind: DatabaseKind,
) -> String {
    let mut rendered = statement.to_owned();

    for (index, value) in values.iter().enumerate() {
        let literal = match value {
            Some(value) => sql::quote_literal(value),
            None => "NULL".to_owned(),
        };
        match kind {
            DatabaseKind::Mysql => {
                rendered = rendered.replacen('?', &literal, 1);
            }
            // 倒序替换，避免 $1 先把 $10 的前缀吃掉。
            DatabaseKind::Postgresql => {
                let placeholder = format!("${}", values.len() - index);
                let literal = match &values[values.len() - index - 1] {
                    Some(value) => sql::quote_literal(value),
                    None => "NULL".to_owned(),
                };
                rendered = rendered.replace(&placeholder, &literal);
            }
        }
    }

    rendered
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_like_wildcards() {
        assert_eq!(escape_like("50%_off"), "50\\%\\_off");
    }

    #[test]
    fn rejects_control_characters_in_identifiers() {
        assert!(ensure_identifier("ok_name").is_ok());
        assert!(ensure_identifier("").is_err());
        assert!(ensure_identifier("bad\nname").is_err());
    }

    #[test]
    fn builds_null_conditions_without_parameters() {
        let mut binder = Binder::new(DatabaseKind::Mysql);
        let filters = vec![RowFilter {
            column: "deleted_at".to_owned(),
            operator: RowFilterOperator::IsNull,
            value: String::new(),
        }];

        let clause =
            build_where(&filters, DatabaseKind::Mysql, &BTreeMap::new(), &mut binder).unwrap();
        assert_eq!(clause, " WHERE `deleted_at` IS NULL");
        assert!(binder.values.is_empty());
    }

    #[test]
    fn casts_postgresql_parameters_to_column_types() {
        let mut casts = BTreeMap::new();
        casts.insert("id".to_owned(), "integer".to_owned());
        let mut binder = Binder::new(DatabaseKind::Postgresql);
        let filters = vec![RowFilter {
            column: "id".to_owned(),
            operator: RowFilterOperator::Equals,
            value: "7".to_owned(),
        }];

        let clause = build_where(&filters, DatabaseKind::Postgresql, &casts, &mut binder).unwrap();
        assert_eq!(clause, " WHERE \"id\" = $1::integer");
        assert_eq!(binder.values, vec![Some("7".to_owned())]);
    }

    #[test]
    fn orders_by_quoted_column() {
        let sort = RowSort {
            column: "created at".to_owned(),
            descending: true,
        };
        assert_eq!(
            build_order(Some(&sort), DatabaseKind::Postgresql).unwrap(),
            " ORDER BY \"created at\" DESC"
        );
    }

    #[test]
    fn renders_display_sql_with_literals() {
        let rendered = display_sql(
            "SELECT * FROM `t` WHERE `a` = ? AND `b` = ?",
            &[Some("x".to_owned()), None],
            DatabaseKind::Mysql,
        );
        assert_eq!(rendered, "SELECT * FROM `t` WHERE `a` = 'x' AND `b` = NULL");
    }
}
