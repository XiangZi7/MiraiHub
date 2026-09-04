//! 数据库元数据读取：库、对象、列、索引、外键与 DDL。
//!
//! 两种方言的系统表差异很大，所以每个查询都各写一份而不是硬套一个通用抽象：
//! MySQL 走 information_schema，PostgreSQL 直接查 pg_catalog —— 后者能拿到
//! information_schema 里没有的行数估算、identity 列与约束定义。

use std::collections::BTreeMap;

use sqlx::mysql::{MySqlPool, MySqlRow};
use sqlx::postgres::PgPool;
use sqlx::{Decode, MySql, Row, ValueRef};

use super::error::{DatabaseError, DatabaseResult};
use super::manager::DatabasePool;
use super::models::{
    DatabaseColumn, DatabaseForeignKey, DatabaseIndex, DatabaseObject, DatabaseObjectKind,
    DatabaseRoutineDetail, DatabaseRoutineParameter, DatabaseTableDetail,
};
use super::sql;

const MYSQL_SYSTEM_SCHEMAS: &str = "'information_schema', 'mysql', 'performance_schema', 'sys'";

/// MySQL 9.x 的部分 information_schema 文本列会在预处理协议中报告为 BINARY。
/// `try_get::<String>` 会先做 SQL 类型兼容性检查，因此即便内容是 UTF-8 文本也会失败。
/// 元数据列由 MySQL 自身生成，直接读取协议字节后按连接字符集解码，可同时兼容
/// VARCHAR 与 BINARY 两种类型标记。
fn mysql_metadata_text(row: &MySqlRow, column: &'static str) -> DatabaseResult<String> {
    mysql_optional_metadata_text(row, column)?.ok_or_else(|| {
        DatabaseError::InvalidInput(format!("MySQL 元数据字段 {column} 意外为 NULL"))
    })
}

fn mysql_optional_metadata_text(
    row: &MySqlRow,
    column: &'static str,
) -> DatabaseResult<Option<String>> {
    let value = row.try_get_raw(column).map_err(DatabaseError::Query)?;
    if value.is_null() {
        return Ok(None);
    }
    let text = <String as Decode<'_, MySql>>::decode(value)
        .map_err(|source| DatabaseError::Query(sqlx::Error::Decode(source)))?;
    Ok(Some(text))
}

fn mysql_metadata_text_at(row: &MySqlRow, index: usize) -> DatabaseResult<String> {
    let value = row.try_get_raw(index).map_err(DatabaseError::Query)?;
    if value.is_null() {
        return Ok(String::new());
    }
    <String as Decode<'_, MySql>>::decode(value)
        .map_err(|source| DatabaseError::Query(sqlx::Error::Decode(source)))
}

fn mysql_object_kind(table_type: &str) -> DatabaseObjectKind {
    if table_type.eq_ignore_ascii_case("VIEW") || table_type.eq_ignore_ascii_case("SYSTEM VIEW") {
        DatabaseObjectKind::View
    } else {
        DatabaseObjectKind::Table
    }
}

/// 当前实例上用户可见的库。切库下拉框消费这个列表。
pub async fn list_databases(pool: &DatabasePool) -> DatabaseResult<Vec<String>> {
    match pool {
        DatabasePool::Mysql(pool) => {
            let rows = sqlx::query(&format!(
                "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA \
                 WHERE SCHEMA_NAME NOT IN ({MYSQL_SYSTEM_SCHEMAS}) ORDER BY SCHEMA_NAME"
            ))
            .fetch_all(pool)
            .await
            .map_err(DatabaseError::Query)?;
            rows.iter()
                .map(|row| mysql_metadata_text(row, "SCHEMA_NAME"))
                .collect()
        }
        DatabasePool::Postgresql(pool) => sqlx::query_scalar(
            "SELECT datname FROM pg_database \
                 WHERE datallowconn AND NOT datistemplate \
                   AND has_database_privilege(datname, 'CONNECT') \
                 ORDER BY datname",
        )
        .fetch_all(pool)
        .await
        .map_err(DatabaseError::Query),
    }
}

/// 当前库里的表、视图、存储过程与函数。行数是统计信息里的估算值，不做精确 COUNT。
pub async fn list_objects(pool: &DatabasePool) -> DatabaseResult<Vec<DatabaseObject>> {
    match pool {
        DatabasePool::Mysql(pool) => list_mysql_objects(pool).await,
        DatabasePool::Postgresql(pool) => list_postgresql_objects(pool).await,
    }
}

async fn list_mysql_objects(pool: &MySqlPool) -> DatabaseResult<Vec<DatabaseObject>> {
    let table_rows = sqlx::query(&format!(
        r#"
        SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE,
               CAST(TABLE_ROWS AS SIGNED) AS ROW_ESTIMATE,
               NULLIF(TABLE_COMMENT, '') AS TABLE_COMMENT,
               CAST(CREATE_TIME AS CHAR) AS CREATED_AT,
               CAST(UPDATE_TIME AS CHAR) AS UPDATED_AT
        FROM information_schema.tables
        WHERE TABLE_SCHEMA = DATABASE()
           OR (DATABASE() IS NULL AND TABLE_SCHEMA NOT IN ({MYSQL_SYSTEM_SCHEMAS}))
        ORDER BY TABLE_SCHEMA, TABLE_TYPE, TABLE_NAME
        "#
    ))
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    let mut objects = table_rows
        .into_iter()
        .map(|row| {
            let table_type = mysql_metadata_text(&row, "TABLE_TYPE")?;
            Ok(DatabaseObject {
                schema: mysql_metadata_text(&row, "TABLE_SCHEMA")?,
                name: mysql_metadata_text(&row, "TABLE_NAME")?,
                kind: mysql_object_kind(&table_type),
                identity: String::new(),
                row_estimate: row.try_get("ROW_ESTIMATE").unwrap_or(None),
                comment: mysql_optional_metadata_text(&row, "TABLE_COMMENT")?,
                created_at: mysql_optional_metadata_text(&row, "CREATED_AT")?,
                updated_at: mysql_optional_metadata_text(&row, "UPDATED_AT")?,
            })
        })
        .collect::<DatabaseResult<Vec<_>>>()?;

    let routine_rows = sqlx::query(&format!(
        r#"
        SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE,
               NULLIF(ROUTINE_COMMENT, '') AS ROUTINE_COMMENT,
               CAST(CREATED AS CHAR) AS CREATED_AT,
               CAST(LAST_ALTERED AS CHAR) AS UPDATED_AT
        FROM information_schema.routines
        WHERE ROUTINE_SCHEMA = DATABASE()
           OR (DATABASE() IS NULL AND ROUTINE_SCHEMA NOT IN ({MYSQL_SYSTEM_SCHEMAS}))
        ORDER BY ROUTINE_SCHEMA, ROUTINE_TYPE, ROUTINE_NAME
        "#
    ))
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    for row in routine_rows {
        let routine_type = mysql_metadata_text(&row, "ROUTINE_TYPE")?;
        objects.push(DatabaseObject {
            schema: mysql_metadata_text(&row, "ROUTINE_SCHEMA")?,
            name: mysql_metadata_text(&row, "ROUTINE_NAME")?,
            kind: if routine_type.eq_ignore_ascii_case("PROCEDURE") {
                DatabaseObjectKind::Procedure
            } else {
                DatabaseObjectKind::Function
            },
            identity: String::new(),
            row_estimate: None,
            comment: mysql_optional_metadata_text(&row, "ROUTINE_COMMENT")?,
            created_at: mysql_optional_metadata_text(&row, "CREATED_AT")?,
            updated_at: mysql_optional_metadata_text(&row, "UPDATED_AT")?,
        });
    }

    objects.sort_by(|left, right| {
        (&left.schema, left.kind as u8, &left.name).cmp(&(
            &right.schema,
            right.kind as u8,
            &right.name,
        ))
    });
    Ok(objects)
}

async fn list_postgresql_objects(pool: &PgPool) -> DatabaseResult<Vec<DatabaseObject>> {
    let table_rows = sqlx::query(
        r#"
        SELECT n.nspname AS table_schema,
               c.relname AS table_name,
               c.relkind::text AS table_kind,
               CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS row_estimate,
               obj_description(c.oid, 'pg_class') AS table_comment
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND n.nspname NOT LIKE 'pg_temp%'
        ORDER BY n.nspname, c.relname
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    let mut objects = table_rows
        .into_iter()
        .map(|row| {
            let kind: String = row.try_get("table_kind").map_err(DatabaseError::Query)?;
            Ok(DatabaseObject {
                schema: row.try_get("table_schema").map_err(DatabaseError::Query)?,
                name: row.try_get("table_name").map_err(DatabaseError::Query)?,
                // v = 视图，m = 物化视图；其余按表处理。
                kind: if kind == "v" || kind == "m" {
                    DatabaseObjectKind::View
                } else {
                    DatabaseObjectKind::Table
                },
                identity: String::new(),
                row_estimate: row.try_get("row_estimate").unwrap_or(None),
                comment: row.try_get("table_comment").unwrap_or(None),
                created_at: None,
                updated_at: None,
            })
        })
        .collect::<DatabaseResult<Vec<_>>>()?;

    let routine_rows = sqlx::query(
        r#"
        SELECT n.nspname AS routine_schema,
               p.proname AS routine_name,
               p.prokind::text AS routine_kind,
               pg_get_function_identity_arguments(p.oid) AS identity_arguments,
               obj_description(p.oid, 'pg_proc') AS routine_comment
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prokind IN ('f', 'p')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND n.nspname NOT LIKE 'pg_temp%'
        ORDER BY n.nspname, p.prokind, p.proname, identity_arguments
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    for row in routine_rows {
        let routine_kind: String = row.try_get("routine_kind").map_err(DatabaseError::Query)?;
        objects.push(DatabaseObject {
            schema: row
                .try_get("routine_schema")
                .map_err(DatabaseError::Query)?,
            name: row.try_get("routine_name").map_err(DatabaseError::Query)?,
            kind: if routine_kind == "p" {
                DatabaseObjectKind::Procedure
            } else {
                DatabaseObjectKind::Function
            },
            identity: row
                .try_get("identity_arguments")
                .map_err(DatabaseError::Query)?,
            row_estimate: None,
            comment: row.try_get("routine_comment").unwrap_or(None),
            created_at: None,
            updated_at: None,
        });
    }

    objects.sort_by(|left, right| {
        (&left.schema, left.kind as u8, &left.name, &left.identity).cmp(&(
            &right.schema,
            right.kind as u8,
            &right.name,
            &right.identity,
        ))
    });
    Ok(objects)
}

/// 单个对象的列定义。对象树展开与结构面板都从这里取。
pub async fn describe_object(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Vec<DatabaseColumn>> {
    ensure_target(schema, name)?;

    match pool {
        DatabasePool::Mysql(pool) => describe_mysql_object(pool, schema, name).await,
        DatabasePool::Postgresql(pool) => describe_postgresql_object(pool, schema, name).await,
    }
}

fn ensure_target(schema: &str, name: &str) -> DatabaseResult<()> {
    if schema.trim().is_empty() || name.trim().is_empty() {
        return Err(DatabaseError::InvalidInput(
            "schema 与对象名不能为空".to_owned(),
        ));
    }

    Ok(())
}

async fn describe_mysql_object(
    pool: &MySqlPool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Vec<DatabaseColumn>> {
    let rows = sqlx::query(
        r#"
        SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
               CAST(ORDINAL_POSITION AS SIGNED) AS ORDINAL_POSITION,
               COLUMN_KEY, EXTRA, NULLIF(COLUMN_COMMENT, '') AS COLUMN_COMMENT
        FROM information_schema.columns
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
        "#,
    )
    .bind(schema)
    .bind(name)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    rows.into_iter()
        .map(|row| {
            let nullable = mysql_metadata_text(&row, "IS_NULLABLE")?;
            let key = mysql_metadata_text(&row, "COLUMN_KEY")?;
            let extra = mysql_metadata_text(&row, "EXTRA")?;
            Ok(DatabaseColumn {
                name: mysql_metadata_text(&row, "COLUMN_NAME")?,
                data_type: mysql_metadata_text(&row, "COLUMN_TYPE")?,
                nullable: nullable.eq_ignore_ascii_case("YES"),
                default_value: mysql_optional_metadata_text(&row, "COLUMN_DEFAULT")?,
                ordinal: row
                    .try_get::<i64, _>("ORDINAL_POSITION")
                    .map_err(DatabaseError::Query)? as i32,
                primary_key: key.eq_ignore_ascii_case("PRI"),
                auto_increment: extra.to_ascii_lowercase().contains("auto_increment"),
                comment: mysql_optional_metadata_text(&row, "COLUMN_COMMENT")?,
            })
        })
        .collect()
}

async fn describe_postgresql_object(
    pool: &PgPool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Vec<DatabaseColumn>> {
    let rows = sqlx::query(
        r#"
        SELECT a.attname AS column_name,
               format_type(a.atttypid, a.atttypmod) AS data_type,
               NOT a.attnotnull AS nullable,
               pg_get_expr(d.adbin, d.adrelid) AS column_default,
               a.attnum::int AS ordinal_position,
               COALESCE(pk.is_primary, false) AS primary_key,
               COALESCE(
                 a.attidentity <> '' OR pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%',
                 false
               ) AS auto_increment,
               col_description(a.attrelid, a.attnum) AS column_comment
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        LEFT JOIN LATERAL (
          SELECT true AS is_primary
          FROM pg_index i
          WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY (i.indkey)
          LIMIT 1
        ) pk ON true
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
        "#,
    )
    .bind(schema)
    .bind(name)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    rows.into_iter()
        .map(|row| {
            Ok(DatabaseColumn {
                name: row.try_get("column_name").map_err(DatabaseError::Query)?,
                data_type: row.try_get("data_type").map_err(DatabaseError::Query)?,
                nullable: row.try_get("nullable").unwrap_or(true),
                default_value: row.try_get("column_default").unwrap_or(None),
                ordinal: row
                    .try_get("ordinal_position")
                    .map_err(DatabaseError::Query)?,
                primary_key: row.try_get("primary_key").unwrap_or(false),
                auto_increment: row.try_get("auto_increment").unwrap_or(false),
                comment: row.try_get("column_comment").unwrap_or(None),
            })
        })
        .collect()
}

/// 表的完整结构。数据网格靠 `primary_key` 判断能不能编辑。
pub async fn table_detail(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
    kind: DatabaseObjectKind,
) -> DatabaseResult<DatabaseTableDetail> {
    ensure_target(schema, name)?;
    if !matches!(kind, DatabaseObjectKind::Table | DatabaseObjectKind::View) {
        return Err(DatabaseError::InvalidInput(
            "存储过程或函数请使用例程详情接口".to_owned(),
        ));
    }

    let columns = describe_object(pool, schema, name).await?;
    if columns.is_empty() {
        return Err(DatabaseError::InvalidInput(format!(
            "找不到对象 {schema}.{name}"
        )));
    }

    let indexes = list_indexes(pool, schema, name).await.unwrap_or_default();
    let foreign_keys = list_foreign_keys(pool, schema, name)
        .await
        .unwrap_or_default();
    let primary_key = indexes
        .iter()
        .find(|index| index.primary)
        .map(|index| index.columns.clone())
        // 索引查不出来时退回列上的主键标记，顺序按列序。
        .unwrap_or_else(|| {
            columns
                .iter()
                .filter(|column| column.primary_key)
                .map(|column| column.name.clone())
                .collect()
        });
    let row_estimate = row_estimate(pool, schema, name).await.unwrap_or(None);
    let ddl = build_ddl(pool, schema, name, kind, &columns)
        .await
        .unwrap_or_default();

    Ok(DatabaseTableDetail {
        schema: schema.to_owned(),
        name: name.to_owned(),
        kind,
        columns,
        indexes,
        foreign_keys,
        primary_key,
        row_estimate,
        ddl,
    })
}

/// 存储过程 / 函数的定义、参数与基础信息。
pub async fn routine_detail(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
    kind: DatabaseObjectKind,
    identity: &str,
) -> DatabaseResult<DatabaseRoutineDetail> {
    ensure_target(schema, name)?;
    if !matches!(
        kind,
        DatabaseObjectKind::Procedure | DatabaseObjectKind::Function
    ) {
        return Err(DatabaseError::InvalidInput(
            "只有存储过程和函数能读取例程详情".to_owned(),
        ));
    }

    match pool {
        DatabasePool::Mysql(pool) => mysql_routine_detail(pool, schema, name, kind).await,
        DatabasePool::Postgresql(pool) => {
            postgresql_routine_detail(pool, schema, name, kind, identity).await
        }
    }
}

async fn mysql_routine_detail(
    pool: &MySqlPool,
    schema: &str,
    name: &str,
    kind: DatabaseObjectKind,
) -> DatabaseResult<DatabaseRoutineDetail> {
    let routine_type = if kind == DatabaseObjectKind::Procedure {
        "PROCEDURE"
    } else {
        "FUNCTION"
    };
    let info = sqlx::query(
        r#"
        SELECT DTD_IDENTIFIER,
               NULLIF(ROUTINE_COMMENT, '') AS ROUTINE_COMMENT,
               CAST(CREATED AS CHAR) AS CREATED_AT,
               CAST(LAST_ALTERED AS CHAR) AS UPDATED_AT
        FROM information_schema.routines
        WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ? AND ROUTINE_TYPE = ?
        "#,
    )
    .bind(schema)
    .bind(name)
    .bind(routine_type)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::Query)?
    .ok_or_else(|| DatabaseError::InvalidInput(format!("找不到例程 {schema}.{name}")))?;

    let parameter_rows = sqlx::query(
        r#"
        SELECT CAST(ORDINAL_POSITION AS SIGNED) AS ORDINAL_POSITION,
               COALESCE(PARAMETER_NAME, '') AS PARAMETER_NAME,
               COALESCE(PARAMETER_MODE, 'IN') AS PARAMETER_MODE,
               DTD_IDENTIFIER
        FROM information_schema.parameters
        WHERE SPECIFIC_SCHEMA = ? AND SPECIFIC_NAME = ? AND ORDINAL_POSITION > 0
        ORDER BY ORDINAL_POSITION
        "#,
    )
    .bind(schema)
    .bind(name)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;
    let parameters = parameter_rows
        .iter()
        .map(|row| {
            Ok(DatabaseRoutineParameter {
                name: mysql_metadata_text(row, "PARAMETER_NAME")?,
                data_type: mysql_metadata_text(row, "DTD_IDENTIFIER")?,
                mode: mysql_metadata_text(row, "PARAMETER_MODE")?,
                ordinal: row.try_get("ORDINAL_POSITION").unwrap_or_default(),
            })
        })
        .collect::<DatabaseResult<Vec<_>>>()?;

    let show = format!(
        "SHOW CREATE {routine_type} {}",
        sql::qualified_name(schema, name, super::models::DatabaseKind::Mysql)
    );
    let ddl_row = sqlx::query(&show)
        .fetch_one(pool)
        .await
        .map_err(DatabaseError::Query)?;
    // SHOW CREATE PROCEDURE / FUNCTION 的第 3 列是完整定义。
    let ddl = mysql_metadata_text_at(&ddl_row, 2)?;

    Ok(DatabaseRoutineDetail {
        schema: schema.to_owned(),
        name: name.to_owned(),
        kind,
        identity: String::new(),
        parameters,
        return_type: if kind == DatabaseObjectKind::Function {
            mysql_optional_metadata_text(&info, "DTD_IDENTIFIER")?
        } else {
            None
        },
        language: "SQL".to_owned(),
        definition: ddl.clone(),
        ddl,
        comment: mysql_optional_metadata_text(&info, "ROUTINE_COMMENT")?,
        created_at: mysql_optional_metadata_text(&info, "CREATED_AT")?,
        updated_at: mysql_optional_metadata_text(&info, "UPDATED_AT")?,
    })
}

async fn postgresql_routine_detail(
    pool: &PgPool,
    schema: &str,
    name: &str,
    kind: DatabaseObjectKind,
    identity: &str,
) -> DatabaseResult<DatabaseRoutineDetail> {
    let prokind = if kind == DatabaseObjectKind::Procedure {
        "p"
    } else {
        "f"
    };
    let row = sqlx::query(
        r#"
        SELECT pg_get_functiondef(p.oid) AS ddl,
               pg_get_function_result(p.oid) AS return_type,
               l.lanname AS language,
               obj_description(p.oid, 'pg_proc') AS routine_comment
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind::text = $3
          AND pg_get_function_identity_arguments(p.oid) = $4
        "#,
    )
    .bind(schema)
    .bind(name)
    .bind(prokind)
    .bind(identity)
    .fetch_optional(pool)
    .await
    .map_err(DatabaseError::Query)?
    .ok_or_else(|| DatabaseError::InvalidInput(format!("找不到例程 {schema}.{name}")))?;

    let parameter_rows = sqlx::query(
        r#"
        SELECT args.ordinality::int AS ordinal,
               COALESCE(p.proargnames[args.ordinality], 'arg' || args.ordinality::text) AS parameter_name,
               format_type(args.type_oid, NULL) AS data_type,
               CASE COALESCE(p.proargmodes[args.ordinality]::text, 'i')
                 WHEN 'o' THEN 'OUT'
                 WHEN 'b' THEN 'INOUT'
                 WHEN 'v' THEN 'VARIADIC'
                 WHEN 't' THEN 'TABLE'
                 ELSE 'IN'
               END AS parameter_mode
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL unnest(
          COALESCE(p.proallargtypes, p.proargtypes::oid[])
        ) WITH ORDINALITY AS args(type_oid, ordinality)
        WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind::text = $3
          AND pg_get_function_identity_arguments(p.oid) = $4
        ORDER BY args.ordinality
        "#,
    )
    .bind(schema)
    .bind(name)
    .bind(prokind)
    .bind(identity)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    let parameters = parameter_rows
        .into_iter()
        .map(|parameter| {
            Ok(DatabaseRoutineParameter {
                name: parameter
                    .try_get("parameter_name")
                    .map_err(DatabaseError::Query)?,
                data_type: parameter
                    .try_get("data_type")
                    .map_err(DatabaseError::Query)?,
                mode: parameter
                    .try_get("parameter_mode")
                    .map_err(DatabaseError::Query)?,
                ordinal: parameter.try_get("ordinal").map_err(DatabaseError::Query)?,
            })
        })
        .collect::<DatabaseResult<Vec<_>>>()?;
    let ddl: String = row.try_get("ddl").map_err(DatabaseError::Query)?;

    Ok(DatabaseRoutineDetail {
        schema: schema.to_owned(),
        name: name.to_owned(),
        kind,
        identity: identity.to_owned(),
        parameters,
        return_type: if kind == DatabaseObjectKind::Function {
            row.try_get("return_type").unwrap_or(None)
        } else {
            None
        },
        language: row.try_get("language").map_err(DatabaseError::Query)?,
        definition: ddl.clone(),
        ddl,
        comment: row.try_get("routine_comment").unwrap_or(None),
        created_at: None,
        updated_at: None,
    })
}

async fn list_indexes(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Vec<DatabaseIndex>> {
    // (索引名, 唯一, 主键) -> 按序号排列的列名
    let mut grouped: BTreeMap<(String, bool, bool), Vec<(i64, String)>> = BTreeMap::new();

    match pool {
        DatabasePool::Mysql(pool) => {
            let rows = sqlx::query(
                r#"
                SELECT INDEX_NAME,
                       CAST(NON_UNIQUE AS SIGNED) AS NON_UNIQUE,
                       CAST(SEQ_IN_INDEX AS SIGNED) AS SEQ_IN_INDEX,
                       COLUMN_NAME
                FROM information_schema.statistics
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
                ORDER BY INDEX_NAME, SEQ_IN_INDEX
                "#,
            )
            .bind(schema)
            .bind(name)
            .fetch_all(pool)
            .await
            .map_err(DatabaseError::Query)?;

            for row in rows {
                let index_name = mysql_metadata_text(&row, "INDEX_NAME")?;
                let unique = row.try_get::<i64, _>("NON_UNIQUE").unwrap_or(1) == 0;
                let primary = index_name == "PRIMARY";
                let sequence = row.try_get::<i64, _>("SEQ_IN_INDEX").unwrap_or(0);
                let column = mysql_optional_metadata_text(&row, "COLUMN_NAME")?;
                grouped
                    .entry((index_name, unique, primary))
                    .or_default()
                    .push((sequence, column.unwrap_or_default()));
            }
        }
        DatabasePool::Postgresql(pool) => {
            let rows = sqlx::query(
                r#"
                SELECT i.relname AS index_name,
                       ix.indisunique AS is_unique,
                       ix.indisprimary AS is_primary,
                       k.ord::bigint AS seq,
                       pg_get_indexdef(ix.indexrelid, k.ord::int, true) AS column_name
                FROM pg_index ix
                JOIN pg_class i ON i.oid = ix.indexrelid
                JOIN pg_class c ON c.oid = ix.indrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN LATERAL generate_series(1, ix.indnatts) AS k(ord) ON true
                WHERE n.nspname = $1 AND c.relname = $2
                ORDER BY i.relname, k.ord
                "#,
            )
            .bind(schema)
            .bind(name)
            .fetch_all(pool)
            .await
            .map_err(DatabaseError::Query)?;

            for row in rows {
                let index_name: String = row.try_get("index_name").unwrap_or_default();
                let unique = row.try_get("is_unique").unwrap_or(false);
                let primary = row.try_get("is_primary").unwrap_or(false);
                let sequence = row.try_get::<i64, _>("seq").unwrap_or(0);
                let column: Option<String> = row.try_get("column_name").unwrap_or(None);
                grouped
                    .entry((index_name, unique, primary))
                    .or_default()
                    .push((sequence, column.unwrap_or_default()));
            }
        }
    }

    Ok(grouped
        .into_iter()
        .map(|((name, unique, primary), mut columns)| {
            columns.sort_by_key(|(sequence, _)| *sequence);
            DatabaseIndex {
                name,
                columns: columns.into_iter().map(|(_, column)| column).collect(),
                unique,
                primary,
            }
        })
        .collect())
}

async fn list_foreign_keys(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Vec<DatabaseForeignKey>> {
    // 约束名 -> (序号, 本列, 目标 schema, 目标表, 目标列)
    let mut grouped: BTreeMap<String, Vec<(i64, String, String, String, String)>> = BTreeMap::new();

    match pool {
        DatabasePool::Mysql(pool) => {
            let rows = sqlx::query(
                r#"
                SELECT CONSTRAINT_NAME, COLUMN_NAME,
                       REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME,
                       CAST(ORDINAL_POSITION AS SIGNED) AS ORDINAL_POSITION
                FROM information_schema.key_column_usage
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
                ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION
                "#,
            )
            .bind(schema)
            .bind(name)
            .fetch_all(pool)
            .await
            .map_err(DatabaseError::Query)?;

            for row in rows {
                let constraint = mysql_metadata_text(&row, "CONSTRAINT_NAME")?;
                let column = mysql_metadata_text(&row, "COLUMN_NAME")?;
                let referenced_schema =
                    mysql_optional_metadata_text(&row, "REFERENCED_TABLE_SCHEMA")?
                        .unwrap_or_default();
                let referenced_table = mysql_optional_metadata_text(&row, "REFERENCED_TABLE_NAME")?
                    .unwrap_or_default();
                let referenced_column =
                    mysql_optional_metadata_text(&row, "REFERENCED_COLUMN_NAME")?
                        .unwrap_or_default();
                grouped.entry(constraint).or_default().push((
                    row.try_get::<i64, _>("ORDINAL_POSITION").unwrap_or(0),
                    column,
                    referenced_schema,
                    referenced_table,
                    referenced_column,
                ));
            }
        }
        DatabasePool::Postgresql(pool) => {
            let rows = sqlx::query(
                r#"
                SELECT con.conname AS constraint_name,
                       k.ord::bigint AS seq,
                       a.attname AS column_name,
                       fn.nspname AS referenced_schema,
                       fc.relname AS referenced_table,
                       fa.attname AS referenced_column
                FROM pg_constraint con
                JOIN pg_class c ON c.oid = con.conrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_class fc ON fc.oid = con.confrelid
                JOIN pg_namespace fn ON fn.oid = fc.relnamespace
                JOIN LATERAL unnest(con.conkey, con.confkey)
                     WITH ORDINALITY AS k(att, fatt, ord) ON true
                JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.att
                JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = k.fatt
                WHERE con.contype = 'f' AND n.nspname = $1 AND c.relname = $2
                ORDER BY con.conname, k.ord
                "#,
            )
            .bind(schema)
            .bind(name)
            .fetch_all(pool)
            .await
            .map_err(DatabaseError::Query)?;

            for row in rows {
                grouped
                    .entry(row.try_get("constraint_name").unwrap_or_default())
                    .or_default()
                    .push((
                        row.try_get::<i64, _>("seq").unwrap_or(0),
                        row.try_get("column_name").unwrap_or_default(),
                        row.try_get("referenced_schema").unwrap_or_default(),
                        row.try_get("referenced_table").unwrap_or_default(),
                        row.try_get("referenced_column").unwrap_or_default(),
                    ));
            }
        }
    }

    Ok(grouped
        .into_iter()
        .map(|(name, mut parts)| {
            parts.sort_by_key(|(sequence, ..)| *sequence);
            let referenced_schema = parts
                .first()
                .map(|(_, _, schema, ..)| schema.clone())
                .unwrap_or_default();
            let referenced_table = parts
                .first()
                .map(|(_, _, _, table, _)| table.clone())
                .unwrap_or_default();
            DatabaseForeignKey {
                name,
                columns: parts.iter().map(|(_, column, ..)| column.clone()).collect(),
                referenced_schema,
                referenced_table,
                referenced_columns: parts.into_iter().map(|(.., column)| column).collect(),
            }
        })
        .collect())
}

async fn row_estimate(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
) -> DatabaseResult<Option<i64>> {
    match pool {
        DatabasePool::Mysql(pool) => sqlx::query_scalar(
            "SELECT CAST(TABLE_ROWS AS SIGNED) FROM information_schema.tables \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
        )
        .bind(schema)
        .bind(name)
        .fetch_optional(pool)
        .await
        .map(Option::flatten),
        DatabasePool::Postgresql(pool) => sqlx::query_scalar(
            "SELECT CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relname = $2",
        )
        .bind(schema)
        .bind(name)
        .fetch_optional(pool)
        .await
        .map(Option::flatten),
    }
    .map_err(DatabaseError::Query)
}

/// 精确行数。估算值不可信时由用户显式触发，可能很慢。
pub async fn count_rows(pool: &DatabasePool, schema: &str, name: &str) -> DatabaseResult<i64> {
    ensure_target(schema, name)?;

    let kind = pool.kind();
    let statement = format!(
        "SELECT COUNT(*) FROM {}",
        sql::qualified_name(schema, name, kind)
    );

    match pool {
        DatabasePool::Mysql(pool) => sqlx::query_scalar(&statement).fetch_one(pool).await,
        DatabasePool::Postgresql(pool) => sqlx::query_scalar(&statement).fetch_one(pool).await,
    }
    .map_err(DatabaseError::Query)
}

/// PostgreSQL 绑定参数需要显式转型（text 不会隐式转成 int），这里取出每列的
/// 底层类型名供 `mutate` 拼 `$1::int4` 这样的转换。MySQL 不需要，返回空表。
pub(crate) async fn column_cast_types(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
) -> DatabaseResult<BTreeMap<String, String>> {
    let DatabasePool::Postgresql(pool) = pool else {
        return Ok(BTreeMap::new());
    };

    let rows = sqlx::query(
        r#"
        SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS cast_type
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        "#,
    )
    .bind(schema)
    .bind(name)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let column: String = row.try_get("column_name").ok()?;
            let cast: String = row.try_get("cast_type").ok()?;
            Some((column, cast))
        })
        .collect())
}

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

async fn build_ddl(
    pool: &DatabasePool,
    schema: &str,
    name: &str,
    kind: DatabaseObjectKind,
    columns: &[DatabaseColumn],
) -> DatabaseResult<String> {
    match pool {
        DatabasePool::Mysql(pool) => mysql_ddl(pool, schema, name, kind).await,
        DatabasePool::Postgresql(pool) => postgresql_ddl(pool, schema, name, kind, columns).await,
    }
}

/// MySQL 自带 SHOW CREATE，直接用服务端给的权威文本。
async fn mysql_ddl(
    pool: &MySqlPool,
    schema: &str,
    name: &str,
    kind: DatabaseObjectKind,
) -> DatabaseResult<String> {
    let keyword = match kind {
        DatabaseObjectKind::View => "VIEW",
        DatabaseObjectKind::Table => "TABLE",
        DatabaseObjectKind::Procedure | DatabaseObjectKind::Function => {
            return Err(DatabaseError::InvalidInput(
                "例程 DDL 请使用例程详情接口".to_owned(),
            ))
        }
    };
    let statement = format!(
        "SHOW CREATE {keyword} {}",
        sql::qualified_name(schema, name, super::models::DatabaseKind::Mysql)
    );

    let row = sqlx::query(&statement)
        .fetch_one(pool)
        .await
        .map_err(DatabaseError::Query)?;

    // 第 0 列是对象名，第 1 列才是建表/建视图语句。
    mysql_metadata_text_at(&row, 1)
}

/// PostgreSQL 没有 SHOW CREATE，按目录信息拼一份等价的 DDL。
async fn postgresql_ddl(
    pool: &PgPool,
    schema: &str,
    name: &str,
    kind: DatabaseObjectKind,
    columns: &[DatabaseColumn],
) -> DatabaseResult<String> {
    let pg = super::models::DatabaseKind::Postgresql;
    let qualified = sql::qualified_name(schema, name, pg);

    if kind == DatabaseObjectKind::View {
        let definition: String = sqlx::query_scalar("SELECT pg_get_viewdef($1::regclass, true)")
            .bind(&qualified)
            .fetch_one(pool)
            .await
            .map_err(DatabaseError::Query)?;
        return Ok(format!(
            "CREATE OR REPLACE VIEW {qualified} AS\n{definition}"
        ));
    }

    let mut lines: Vec<String> = columns
        .iter()
        .map(|column| {
            let mut line = format!(
                "  {} {}",
                sql::quote_identifier(&column.name, pg),
                column.data_type
            );
            if let Some(default) = &column.default_value {
                line.push_str(&format!(" DEFAULT {default}"));
            }
            if !column.nullable {
                line.push_str(" NOT NULL");
            }
            line
        })
        .collect();

    // 约束定义由服务端生成，比自己拼主键/外键/CHECK 更可靠。
    let constraints: Vec<(String, String)> = sqlx::query(
        r#"
        SELECT con.conname AS name, pg_get_constraintdef(con.oid, true) AS definition
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
        ORDER BY con.contype, con.conname
        "#,
    )
    .bind(schema)
    .bind(name)
    .fetch_all(pool)
    .await
    .map_err(DatabaseError::Query)?
    .into_iter()
    .filter_map(|row| {
        Some((
            row.try_get::<String, _>("name").ok()?,
            row.try_get::<String, _>("definition").ok()?,
        ))
    })
    .collect();

    for (constraint, definition) in &constraints {
        lines.push(format!(
            "  CONSTRAINT {} {definition}",
            sql::quote_identifier(constraint, pg)
        ));
    }

    let mut ddl = format!("CREATE TABLE {qualified} (\n{}\n);", lines.join(",\n"));

    // 约束自带的索引已经体现在上面，这里只补独立创建的那些。
    let constraint_names: Vec<&str> = constraints.iter().map(|(name, _)| name.as_str()).collect();
    let extra_indexes: Vec<String> = sqlx::query_scalar(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 \
         AND indexname <> ALL($3) ORDER BY indexname",
    )
    .bind(schema)
    .bind(name)
    .bind(&constraint_names)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if !extra_indexes.is_empty() {
        ddl.push_str("\n\n");
        ddl.push_str(&extra_indexes.join(";\n"));
        ddl.push(';');
    }

    for column in columns.iter().filter(|column| column.comment.is_some()) {
        let comment = column.comment.clone().unwrap_or_default();
        ddl.push_str(&format!(
            "\n\nCOMMENT ON COLUMN {qualified}.{} IS {};",
            sql::quote_identifier(&column.name, pg),
            sql::quote_literal(&comment)
        ));
    }

    Ok(ddl)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_mysql_view_table_types() {
        assert_eq!(mysql_object_kind("VIEW"), DatabaseObjectKind::View);
        assert_eq!(mysql_object_kind("SYSTEM VIEW"), DatabaseObjectKind::View);
        assert_eq!(mysql_object_kind("BASE TABLE"), DatabaseObjectKind::Table);
    }
}
