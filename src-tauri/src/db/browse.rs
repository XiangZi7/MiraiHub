//! 表数据分页浏览。
//!
//! 数据网格不走用户的 SQL，而是由这里按结构化请求拼语句：列名与表名统一
//! 转义，筛选值一律走绑定参数。多取一行判断"后面还有没有"，省掉一次 COUNT。
//!
//! 深分页的 OFFSET 会扫描并丢弃前面所有行，所以有主键时改走键集分页。前端接口
//! 仍只传 offset：后端按会话记住每个已访问页起点的主键，翻到记过的页用键集，
//! 跳到没记过的页才用 OFFSET。按非主键列排序时用（排序列, 主键）复合游标，
//! 主键兜底保证顺序唯一，排序列的 NULL 按各方言默认位置处理。

use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

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
/// 主键信息的缓存时长，表结构被改后最多这么久生效。
const CURSOR_PLAN_TTL: Duration = Duration::from_secs(30);
/// 同时记住的浏览视图数，超出时淘汰最久未用的。
const MAX_CURSOR_ENTRIES: usize = 64;
/// 单个视图记住的页起点数。
const MAX_CURSOR_ANCHORS: usize = 512;

/// 键集分页方案：先按排序列（若有）再按完整主键排序，方向统一。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct KeysetPlan {
    pub columns: Vec<String>,
    pub descending: bool,
    /// 主键之前的非主键排序列；None 表示只按主键排序。
    pub sort_column: Option<SortKey>,
}

/// 复合游标里的非主键排序列。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SortKey {
    pub name: String,
    /// 可空列的游标要处理 NULL；非空列直接用行值比较，更容易命中索引。
    pub nullable: bool,
}

/// 游标值：有排序列时首项是排序列的值（可能为 NULL），其后依次是主键值。
type Cursor = Vec<Option<String>>;

/// 一个浏览视图（表 + 筛选 + 排序）的翻页状态。
struct CursorEntry {
    plan: Option<KeysetPlan>,
    /// 页起点 offset → 该页前一行的游标值。
    anchors: BTreeMap<u64, Cursor>,
    resolved_at: Instant,
    touched_at: Instant,
}

static CURSORS: OnceLock<Mutex<HashMap<String, CursorEntry>>> = OnceLock::new();

/// 取翻页状态表；锁中毒时状态仍可用，继续使用内部数据。
fn cursors() -> std::sync::MutexGuard<'static, HashMap<String, CursorEntry>> {
    CURSORS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

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
            DatabaseKind::Mysql | DatabaseKind::Sqlite => "?".to_owned(),
            DatabaseKind::Postgresql => format!("${}", self.values.len()),
        }
    }
}

/// 不带翻页状态的普通查询，始终使用 OFFSET。
pub async fn fetch_rows(
    pool: &DatabasePool,
    request: &RowPageRequest,
) -> DatabaseResult<DatabaseRowPage> {
    run_page(pool, request, None, None).await
}

/// 数据网格入口：同一会话连续翻页时自动走键集分页，接口与 OFFSET 分页一致。
pub async fn fetch_rows_in_session(
    session_id: &str,
    pool: &DatabasePool,
    request: &RowPageRequest,
) -> DatabaseResult<DatabaseRowPage> {
    // 空 schema 依赖会话活动库，切库后同名表会串，这种情况不记状态。
    if request.schema.trim().is_empty() {
        return fetch_rows(pool, request).await;
    }

    let key = cursor_key(session_id, request);
    let plan = resolve_plan(&key, pool, request).await;
    let anchor = cursors()
        .get(&key)
        .and_then(|entry| entry.anchors.get(&request.offset).cloned())
        .filter(|_| plan.is_some() && request.offset > 0);

    let page = match run_page_at(pool, request, plan.as_ref(), anchor.as_deref()).await {
        Ok(page) => page,
        // 键集条件失败（如类型转换报错）不该挡住浏览，退回 OFFSET 重试一次。
        Err(error) if anchor.is_none() => return Err(error),
        Err(error) => {
            log::debug!("键集分页失败，退回 OFFSET：{error}");
            if let Some(entry) = cursors().get_mut(&key) {
                entry.anchors.clear();
            }
            run_page_at(pool, request, plan.as_ref(), None).await?
        }
    };

    if let Some(plan) = plan.as_ref() {
        if let Some(next) = next_cursor(&page, plan) {
            if let Some(entry) = cursors().get_mut(&key) {
                entry
                    .anchors
                    .insert(request.offset + page.rows.len() as u64, next);
                while entry.anchors.len() > MAX_CURSOR_ANCHORS {
                    entry.anchors.pop_first();
                }
            }
        }
    }

    Ok(page)
}

/// 视图指纹：筛选或排序一变就是另一个视图，旧页起点不再适用。
fn cursor_key(session_id: &str, request: &RowPageRequest) -> String {
    format!(
        "{session_id}\0{}\0{}\0{:?}\0{}\0{:?}\0{:?}",
        request.schema.trim(),
        request.table.trim(),
        request.filters,
        request.match_any,
        request.where_sql,
        request
            .sort
            .as_ref()
            .map(|sort| (sort.column.trim().to_owned(), sort.descending)),
    )
}

/// 取视图的键集方案，过期才重查元数据；主键变化时作废已记录的页起点。
async fn resolve_plan(
    key: &str,
    pool: &DatabasePool,
    request: &RowPageRequest,
) -> Option<KeysetPlan> {
    {
        let mut cursors = cursors();
        if let Some(entry) = cursors.get_mut(key) {
            entry.touched_at = Instant::now();
            if entry.resolved_at.elapsed() < CURSOR_PLAN_TTL {
                return entry.plan.clone();
            }
        }
    }

    let plan = match load_plan(pool, request).await {
        Ok(plan) => plan,
        Err(error) => {
            log::debug!("读取主键失败，本页使用 OFFSET：{error}");
            None
        }
    };

    let now = Instant::now();
    let mut cursors = cursors();
    let entry = cursors.entry(key.to_owned()).or_insert_with(|| CursorEntry {
        plan: None,
        anchors: BTreeMap::new(),
        resolved_at: now,
        touched_at: now,
    });
    if entry.plan != plan {
        entry.anchors.clear();
    }
    entry.plan = plan.clone();
    entry.resolved_at = now;
    entry.touched_at = now;

    while cursors.len() > MAX_CURSOR_ENTRIES {
        let oldest = cursors
            .iter()
            .min_by_key(|(_, entry)| entry.touched_at)
            .map(|(key, _)| key.clone());
        match oldest {
            Some(oldest) => cursors.remove(&oldest),
            None => break,
        };
    }

    plan
}

/// 读取主键与排序列的元数据并生成键集方案；按非主键首列排序时才额外查列信息。
async fn load_plan(
    pool: &DatabasePool,
    request: &RowPageRequest,
) -> DatabaseResult<Option<KeysetPlan>> {
    let (schema, table) = (request.schema.trim(), request.table.trim());
    let primary_key = metadata::primary_key_columns(pool, schema, table).await?;
    let sort = request.sort.as_ref().filter(|sort| {
        let column = sort.column.trim();
        !column.is_empty()
            && primary_key
                .first()
                .is_some_and(|(first, _)| first != column)
    });
    let Some(sort) = sort else {
        return Ok(keyset_plan(&primary_key, request.sort.as_ref()));
    };

    let column = sort.column.trim();
    // 排序列本身是主键后续列时一定非空，否则查列定义拿类型与可空性。
    let sort_type = match primary_key.iter().find(|(name, _)| name == column) {
        Some((_, data_type)) => Some((data_type.clone(), false)),
        None => metadata::describe_object(pool, schema, table)
            .await?
            .into_iter()
            .find(|item| item.name == column)
            .map(|item| (item.data_type, item.nullable)),
    };
    Ok(sort_type.and_then(|(data_type, nullable)| {
        keyset_plan_with_sort(&primary_key, sort, &data_type, nullable)
    }))
}

/// 判断能否只按主键走键集：主键类型可靠比较，且排序为默认或以主键首列为准。
/// 按其他列排序需要该列的类型信息，见 `keyset_plan_with_sort`。
pub(super) fn keyset_plan(
    primary_key: &[(String, String)],
    sort: Option<&RowSort>,
) -> Option<KeysetPlan> {
    let first = primary_key.first()?;
    if !primary_key
        .iter()
        .all(|(_, data_type)| is_keyset_type(data_type))
    {
        return None;
    }
    let descending = match sort.filter(|sort| !sort.column.trim().is_empty()) {
        None => false,
        Some(sort) if sort.column.trim() == first.0 => sort.descending,
        Some(_) => return None,
    };

    Some(KeysetPlan {
        columns: primary_key.iter().map(|(name, _)| name.clone()).collect(),
        descending,
        sort_column: None,
    })
}

/// 按非主键首列排序时生成（排序列, 主键）复合游标方案；排序列类型不可靠比较时返回 None 退回 OFFSET。
pub(super) fn keyset_plan_with_sort(
    primary_key: &[(String, String)],
    sort: &RowSort,
    sort_type: &str,
    nullable: bool,
) -> Option<KeysetPlan> {
    let column = sort.column.trim();
    let mut plan = keyset_plan(primary_key, None)?;
    if column.is_empty() || column == plan.columns[0] {
        return keyset_plan(primary_key, Some(sort));
    }
    if !is_keyset_type(sort_type) {
        return None;
    }
    plan.descending = sort.descending;
    plan.sort_column = Some(SortKey {
        name: column.to_owned(),
        nullable,
    });
    Some(plan)
}

/// 只接受文本化后能原样比较的类型；浮点、时间、二进制的展示值可能和存储值不同。
fn is_keyset_type(data_type: &str) -> bool {
    let lower = data_type.trim().to_ascii_lowercase();
    if lower.contains("binary") || lower.contains("blob") {
        return false;
    }
    let word = lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .next()
        .unwrap_or("");
    matches!(
        word,
        "tinyint"
            | "smallint"
            | "mediumint"
            | "int"
            | "integer"
            | "bigint"
            | "int2"
            | "int4"
            | "int8"
            | "serial"
            | "smallserial"
            | "bigserial"
            | "char"
            | "varchar"
            | "character"
            | "text"
            | "uuid"
    )
}

/// 只按主键翻页时从本页末行取下一页起点（导出等调用方使用）；带排序列的方案返回 None。
pub(super) fn next_anchor(page: &DatabaseRowPage, plan: &KeysetPlan) -> Option<Vec<String>> {
    if plan.sort_column.is_some() {
        return None;
    }
    next_cursor(page, plan)?.into_iter().collect()
}

/// 从本页末行取下一页的游标；没有下一页、主键为 NULL 或值不可比较时返回 None。
fn next_cursor(page: &DatabaseRowPage, plan: &KeysetPlan) -> Option<Cursor> {
    if !page.has_more {
        return None;
    }
    let last = page.rows.last()?;
    // 取一列的末行值；外层 None 表示该列不能用作游标，内层 None 是 NULL。
    let value_of = |name: &str| -> Option<Option<String>> {
        let index = page
            .columns
            .iter()
            .position(|column| column.name == name)?;
        // 驱动把列标成二进制时，解码结果是展示形式，不能拿回去比较。
        let data_type = page.columns[index].data_type.to_ascii_uppercase();
        if data_type.contains("BINARY") || data_type.contains("BLOB") {
            return None;
        }
        last.get(index).cloned()
    };

    let mut cursor = Vec::with_capacity(plan.columns.len() + 1);
    if let Some(sort) = &plan.sort_column {
        cursor.push(value_of(&sort.name)?);
    }
    for name in &plan.columns {
        // 主键值为 NULL 时无法定位，放弃键集。
        cursor.push(Some(value_of(name)??));
    }
    Some(cursor)
}

/// 拼若干列的行值比较：单列直接比较，多列用 `(a, b) > (?, ?)`。
fn row_compare(
    columns: &[&str],
    values: &[String],
    operator: &str,
    kind: DatabaseKind,
    casts: &BTreeMap<String, String>,
    binder: &mut Binder,
) -> String {
    let mut quoted = Vec::with_capacity(columns.len());
    let mut placeholders = Vec::with_capacity(columns.len());
    for (column, value) in columns.iter().zip(values) {
        quoted.push(sql::quote_identifier(column, kind));
        let placeholder = binder.push(Some(value.clone()));
        placeholders.push(cast_placeholder(&placeholder, column, kind, casts));
    }
    if quoted.len() == 1 {
        format!("{} {operator} {}", quoted[0], placeholders[0])
    } else {
        format!(
            "({}) {operator} ({})",
            quoted.join(", "),
            placeholders.join(", ")
        )
    }
}

/// 拼键集条件；游标与方案对不上时返回 None 退回 OFFSET。
/// 带排序列时按 NULL 的位置分情况：MySQL/SQLite 把 NULL 当最小值，PostgreSQL 当最大值，
/// 再由升降序决定 NULL 段排在非 NULL 段之前还是之后。
fn keyset_condition(
    plan: &KeysetPlan,
    cursor: &[Option<String>],
    kind: DatabaseKind,
    casts: &BTreeMap<String, String>,
    binder: &mut Binder,
) -> Option<String> {
    let operator = if plan.descending { "<" } else { ">" };
    let keys = plan.columns.iter().map(String::as_str).collect::<Vec<_>>();
    let (sort, key_cursor) = match &plan.sort_column {
        Some(sort) => {
            let (sort_value, rest) = cursor.split_first()?;
            (Some((sort, sort_value)), rest)
        }
        None => (None, cursor),
    };
    let key_values = key_cursor.iter().cloned().collect::<Option<Vec<_>>>()?;
    if key_values.len() != keys.len() {
        return None;
    }
    let Some((sort, sort_value)) = sort else {
        return Some(row_compare(&keys, &key_values, operator, kind, casts, binder));
    };

    let column = sql::quote_identifier(&sort.name, kind);
    let nulls_after = (kind == DatabaseKind::Postgresql) != plan.descending;
    Some(match sort_value {
        // 起点在 NULL 段：剩下同为 NULL 且主键更靠后的行；NULL 段在前时再加上全部非 NULL 行。
        None => {
            let tail = row_compare(&keys, &key_values, operator, kind, casts, binder);
            if nulls_after {
                format!("({column} IS NULL AND {tail})")
            } else {
                format!("({column} IS NOT NULL OR {tail})")
            }
        }
        // 起点是具体值：（排序列, 主键）行值比较，NULL 段在后时把整段 NULL 也带上。
        Some(value) => {
            let mut columns = vec![sort.name.as_str()];
            columns.extend(&keys);
            let mut values = vec![value.clone()];
            values.extend(key_values);
            let compare = row_compare(&columns, &values, operator, kind, casts, binder);
            if sort.nullable && nulls_after {
                format!("({compare} OR {column} IS NULL)")
            } else {
                compare
            }
        }
    })
}

/// 先按排序列再按完整主键排序，保证键集翻页顺序唯一；NULL 位置沿用方言默认。
fn keyset_order(plan: &KeysetPlan, kind: DatabaseKind) -> String {
    let direction = if plan.descending { "DESC" } else { "ASC" };
    let columns = plan
        .sort_column
        .iter()
        .map(|sort| sort.name.as_str())
        .chain(plan.columns.iter().map(String::as_str))
        .map(|column| format!("{} {direction}", sql::quote_identifier(column, kind)))
        .collect::<Vec<_>>()
        .join(", ");
    format!(" ORDER BY {columns}")
}

/// 执行一页查询（主键起点版本，供导出等只按主键翻页的调用方使用）。
pub(super) async fn run_page(
    pool: &DatabasePool,
    request: &RowPageRequest,
    plan: Option<&KeysetPlan>,
    anchor: Option<&[String]>,
) -> DatabaseResult<DatabaseRowPage> {
    let cursor = anchor.map(|anchor| anchor.iter().cloned().map(Some).collect::<Cursor>());
    run_page_at(pool, request, plan, cursor.as_deref()).await
}

/// 执行一页查询。plan 决定排序，cursor 存在时用键集定位，否则用 OFFSET。
async fn run_page_at(
    pool: &DatabasePool,
    request: &RowPageRequest,
    plan: Option<&KeysetPlan>,
    anchor: Option<&[Option<String>]>,
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
    let casts = if request.filters.is_empty() && anchor.is_none() {
        BTreeMap::new()
    } else {
        metadata::column_cast_types(pool, schema, table)
            .await
            .unwrap_or_default()
    };

    let mut binder = Binder::new(kind);
    let mut where_clause = build_where(
        &request.filters,
        request.match_any,
        kind,
        &casts,
        &mut binder,
    )?;
    // 高级模式的手写条件原样拼入（加括号隔离优先级），只拦截会截断语句的分号。
    if let Some(raw) = request
        .where_sql
        .as_deref()
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
    {
        if raw.contains(';') {
            return Err(DatabaseError::InvalidInput(
                "WHERE 条件不能包含分号".to_owned(),
            ));
        }
        where_clause = if where_clause.is_empty() {
            format!(" WHERE ({raw})")
        } else {
            format!(" WHERE ({}) AND ({raw})", &where_clause[" WHERE ".len()..])
        };
    }
    let order_clause = match plan {
        Some(plan) => keyset_order(plan, kind),
        None => build_order(request.sort.as_ref(), kind)?,
    };
    let keyset = plan
        .zip(anchor)
        .and_then(|(plan, anchor)| keyset_condition(plan, anchor, kind, &casts, &mut binder));
    if let Some(condition) = keyset.as_deref() {
        where_clause = if where_clause.is_empty() {
            format!(" WHERE {condition}")
        } else {
            format!(
                " WHERE ({}) AND {condition}",
                &where_clause[" WHERE ".len()..]
            )
        };
    }
    let offset_clause = if keyset.is_some() {
        String::new()
    } else {
        format!(" OFFSET {}", request.offset)
    };

    // 多查一行用来判断还有没有下一页。
    let statement = format!(
        "SELECT * FROM {}{where_clause}{order_clause} LIMIT {}{offset_clause}",
        sql::qualified_name(schema, table, kind),
        limit as u64 + 1,
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
        DatabasePool::Sqlite(pool) => {
            let mut query = sqlx::query(&statement);
            for value in &binder.values {
                query = query.bind(value.clone());
            }
            let rows = query.fetch_all(pool).await.map_err(DatabaseError::Query)?;
            (
                rows.first().map(query::sqlite_columns).unwrap_or_default(),
                rows.iter()
                    .map(query::decode_sqlite_row)
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
    match_any: bool,
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
            RowFilterOperator::Contains
            | RowFilterOperator::StartsWith
            | RowFilterOperator::NotContains => {
                let pattern = if filter.operator == RowFilterOperator::StartsWith {
                    format!("{}%", escape_like(&filter.value))
                } else {
                    format!("%{}%", escape_like(&filter.value))
                };
                let placeholder = binder.push(Some(pattern));
                let not = if filter.operator == RowFilterOperator::NotContains {
                    "NOT "
                } else {
                    ""
                };
                match kind {
                    // 文本化后比较，数值列也能用同一个筛选框；MySQL 默认排序规则已经
                    // 大小写不敏感，PostgreSQL 需要显式 ILIKE。
                    DatabaseKind::Mysql => {
                        format!("CAST({quoted} AS CHAR) {not}LIKE {placeholder}")
                    }
                    DatabaseKind::Postgresql => format!("{quoted}::text {not}ILIKE {placeholder}"),
                    // SQLite 的 LIKE 对 ASCII 默认不区分大小写
                    DatabaseKind::Sqlite => {
                        format!("CAST({quoted} AS TEXT) {not}LIKE {placeholder} ESCAPE '\\'")
                    }
                }
            }
            RowFilterOperator::In | RowFilterOperator::NotIn => {
                let items = split_list(&filter.value);
                if items.is_empty() {
                    return Err(DatabaseError::InvalidInput(format!(
                        "列 {column} 的 IN 列表不能为空"
                    )));
                }
                let placeholders = items
                    .into_iter()
                    .map(|item| {
                        let placeholder = binder.push(Some(item));
                        cast_placeholder(&placeholder, column, kind, casts)
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                let not = if filter.operator == RowFilterOperator::NotIn {
                    "NOT "
                } else {
                    ""
                };
                format!("{quoted} {not}IN ({placeholders})")
            }
            RowFilterOperator::Between => {
                let low = binder.push(Some(filter.value.clone()));
                let low = cast_placeholder(&low, column, kind, casts);
                let high = binder.push(Some(filter.value2.clone()));
                let high = cast_placeholder(&high, column, kind, casts);
                format!("{quoted} BETWEEN {low} AND {high}")
            }
            _ => {
                let operator = match filter.operator {
                    RowFilterOperator::Equals => "=",
                    RowFilterOperator::NotEquals => "<>",
                    RowFilterOperator::GreaterThan => ">",
                    RowFilterOperator::LessThan => "<",
                    RowFilterOperator::GreaterOrEqual => ">=",
                    RowFilterOperator::LessOrEqual => "<=",
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

    if match_any && conditions.len() > 1 {
        let joined = conditions
            .iter()
            .map(|condition| format!("({condition})"))
            .collect::<Vec<_>>()
            .join(" OR ");
        return Ok(format!(" WHERE {joined}"));
    }

    Ok(format!(" WHERE {}", conditions.join(" AND ")))
}

/// IN 列表：有换行按行切，否则按逗号切；去掉首尾空白与空项。
fn split_list(value: &str) -> Vec<String> {
    let separator = if value.contains('\n') { '\n' } else { ',' };
    value
        .split(separator)
        .map(|item| item.trim().to_owned())
        .filter(|item| !item.is_empty())
        .collect()
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
            DatabaseKind::Mysql | DatabaseKind::Sqlite => {
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

    /// 连续翻页走键集，回到记过的页和跳页得到的行都与 OFFSET 语义一致。
    #[tokio::test]
    async fn session_paging_switches_to_keyset_and_matches_offset() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        for id in 1..=5 {
            sqlx::query("INSERT INTO t VALUES (?, 'x')")
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
        }
        let pool = DatabasePool::Sqlite(pool);
        let request = |offset| RowPageRequest {
            schema: "main".to_owned(),
            table: "t".to_owned(),
            offset,
            limit: 2,
            sort: None,
            filters: Vec::new(),
            match_any: false,
            where_sql: None,
        };
        let session = format!("keyset-test-{}", rand::random::<u64>());
        let first_id = |page: &DatabaseRowPage| page.rows[0][0].clone().unwrap();

        let first = fetch_rows_in_session(&session, &pool, &request(0)).await.unwrap();
        assert!(first.sql.contains("OFFSET 0"));
        assert_eq!(first_id(&first), "1");

        let second = fetch_rows_in_session(&session, &pool, &request(2)).await.unwrap();
        assert!(!second.sql.contains("OFFSET"), "{}", second.sql);
        assert_eq!(first_id(&second), "3");

        let third = fetch_rows_in_session(&session, &pool, &request(4)).await.unwrap();
        assert_eq!(first_id(&third), "5");
        assert!(!third.has_more);

        // 回到上一页复用已记录的起点；没记过的 offset 退回 OFFSET。
        let back = fetch_rows_in_session(&session, &pool, &request(2)).await.unwrap();
        assert_eq!(first_id(&back), "3");
        let jump = fetch_rows_in_session(&session, &pool, &request(1)).await.unwrap();
        assert!(jump.sql.contains("OFFSET 1"));
        assert_eq!(first_id(&jump), "2");
    }

    /// 构造测试用主键列。
    fn key(name: &str, data_type: &str) -> (String, String) {
        (name.to_owned(), data_type.to_owned())
    }

    #[test]
    fn keyset_applies_only_to_primary_key_order() {
        let primary = [key("id", "bigint(20) unsigned")];
        assert!(!keyset_plan(&primary, None).unwrap().descending);
        let sort = |column: &str| RowSort {
            column: column.to_owned(),
            descending: true,
        };
        assert!(keyset_plan(&primary, Some(&sort("id"))).unwrap().descending);
        assert!(keyset_plan(&primary, Some(&sort("name"))).is_none());
        assert!(keyset_plan(&[], None).is_none());
    }

    #[test]
    fn keyset_rejects_unreliable_types() {
        for data_type in ["float", "datetime", "varbinary(16)", "interval", "char(36) binary"] {
            assert!(
                keyset_plan(&[key("id", data_type)], None).is_none(),
                "{data_type}"
            );
        }
        assert!(keyset_plan(&[key("id", "character varying(20)")], None).is_some());
    }

    #[test]
    fn keyset_condition_uses_row_values_for_composite_keys() {
        let plan = KeysetPlan {
            columns: vec!["a".to_owned(), "b".to_owned()],
            descending: false,
            sort_column: None,
        };
        let mut binder = Binder::new(DatabaseKind::Mysql);
        let condition = keyset_condition(
            &plan,
            &[Some("1".to_owned()), Some("x".to_owned())],
            DatabaseKind::Mysql,
            &BTreeMap::new(),
            &mut binder,
        );
        assert_eq!(condition.as_deref(), Some("(`a`, `b`) > (?, ?)"));
        assert_eq!(
            keyset_order(&plan, DatabaseKind::Mysql),
            " ORDER BY `a` ASC, `b` ASC"
        );
    }

    /// 构造按非主键列排序的复合游标方案。
    fn sorted_plan(descending: bool, nullable: bool) -> KeysetPlan {
        keyset_plan_with_sort(
            &[key("id", "integer")],
            &RowSort {
                column: "name".to_owned(),
                descending,
            },
            "varchar(20)",
            nullable,
        )
        .unwrap()
    }

    #[test]
    fn keyset_plan_with_sort_falls_back_for_unreliable_sort_types() {
        let sort = RowSort {
            column: "score".to_owned(),
            descending: false,
        };
        assert!(keyset_plan_with_sort(&[key("id", "int")], &sort, "double", true).is_none());
        assert!(keyset_plan_with_sort(&[], &sort, "int", true).is_none());
        let plan = keyset_plan_with_sort(&[key("id", "int")], &sort, "int", true).unwrap();
        assert_eq!(plan.sort_column.unwrap().name, "score");
        // 排序列就是主键首列时退化成只按主键的方案。
        let by_id = RowSort {
            column: "id".to_owned(),
            descending: true,
        };
        let plan = keyset_plan_with_sort(&[key("id", "int")], &by_id, "int", false).unwrap();
        assert!(plan.sort_column.is_none() && plan.descending);
    }

    #[test]
    fn sorted_keyset_condition_places_nulls_per_dialect() {
        let cursor = |value: Option<&str>| vec![value.map(str::to_owned), Some("7".to_owned())];
        let render = |plan: &KeysetPlan, kind, value| {
            let mut binder = Binder::new(kind);
            keyset_condition(plan, &cursor(value), kind, &BTreeMap::new(), &mut binder).unwrap()
        };

        // MySQL 升序 NULL 在前：值起点不必带 NULL，NULL 起点要带上全部非 NULL 行。
        let asc = sorted_plan(false, true);
        assert_eq!(
            render(&asc, DatabaseKind::Mysql, Some("b")),
            "(`name`, `id`) > (?, ?)"
        );
        assert_eq!(
            render(&asc, DatabaseKind::Mysql, None),
            "(`name` IS NOT NULL OR `id` > ?)"
        );
        // PostgreSQL 升序 NULL 在后。
        assert_eq!(
            render(&asc, DatabaseKind::Postgresql, Some("b")),
            "((\"name\", \"id\") > ($1::text, $2::text) OR \"name\" IS NULL)"
        );
        assert_eq!(
            render(&asc, DatabaseKind::Postgresql, None),
            "(\"name\" IS NULL AND \"id\" > $1::text)"
        );
        // MySQL 降序 NULL 在后；非空列不追加 NULL 段。
        let desc = sorted_plan(true, true);
        assert_eq!(
            render(&desc, DatabaseKind::Mysql, Some("b")),
            "((`name`, `id`) < (?, ?) OR `name` IS NULL)"
        );
        assert_eq!(
            render(&sorted_plan(true, false), DatabaseKind::Mysql, Some("b")),
            "(`name`, `id`) < (?, ?)"
        );
        assert_eq!(
            keyset_order(&desc, DatabaseKind::Mysql),
            " ORDER BY `name` DESC, `id` DESC"
        );
    }

    /// 按含 NULL 与重复值的非主键列翻页，键集逐页结果与一次性全量排序完全一致。
    #[tokio::test]
    async fn sorted_session_paging_matches_full_order_with_nulls() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        let names = [Some("b"), None, Some("a"), Some("b"), None, Some("c"), Some("a"), None];
        for (index, name) in names.iter().enumerate() {
            sqlx::query("INSERT INTO t VALUES (?, ?)")
                .bind(index as i64 + 1)
                .bind(*name)
                .execute(&pool)
                .await
                .unwrap();
        }
        let pool = DatabasePool::Sqlite(pool);

        for descending in [false, true] {
            let request = |offset, limit| RowPageRequest {
                schema: "main".to_owned(),
                table: "t".to_owned(),
                offset,
                limit,
                sort: Some(RowSort {
                    column: "name".to_owned(),
                    descending,
                }),
                filters: Vec::new(),
                match_any: false,
                where_sql: None,
            };
            let ids = |page: &DatabaseRowPage| {
                page.rows
                    .iter()
                    .map(|row| row[0].clone().unwrap())
                    .collect::<Vec<_>>()
            };
            // SQLite 把 NULL 当最小值，与 Rust 的 None < Some 一致；同值按主键兜底。
            let mut expected = names
                .iter()
                .enumerate()
                .map(|(index, name)| (*name, index as i64 + 1))
                .collect::<Vec<_>>();
            expected.sort();
            if descending {
                expected.reverse();
            }
            let expected = expected
                .into_iter()
                .map(|(_, id)| id.to_string())
                .collect::<Vec<_>>();
            let session = format!("sorted-keyset-test-{}", rand::random::<u64>());
            let mut paged = Vec::new();
            let mut offset = 0;
            loop {
                let page = fetch_rows_in_session(&session, &pool, &request(offset, 3))
                    .await
                    .unwrap();
                if offset > 0 {
                    assert!(!page.sql.contains("OFFSET"), "{}", page.sql);
                }
                paged.extend(ids(&page));
                offset += page.rows.len() as u64;
                if !page.has_more {
                    break;
                }
            }
            assert_eq!(paged, expected, "descending={descending}");
        }
    }

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
            value2: String::new(),
        }];

        let clause = build_where(
            &filters,
            false,
            DatabaseKind::Mysql,
            &BTreeMap::new(),
            &mut binder,
        )
        .unwrap();
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
            value2: String::new(),
        }];

        let clause = build_where(
            &filters,
            false,
            DatabaseKind::Postgresql,
            &casts,
            &mut binder,
        )
        .unwrap();
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
