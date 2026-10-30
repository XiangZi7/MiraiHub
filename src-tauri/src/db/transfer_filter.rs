//! SQL transfer options operate on whole, dialect-aware statements, never on lines.

use super::super::error::{DatabaseError, DatabaseResult};
use super::super::models::{DatabaseImportOptions, DatabaseKind, DatabaseTransferContent};
use super::super::sql;

#[derive(Debug)]
struct Token<'a> {
    text: &'a str,
    start: usize,
    end: usize,
    identifier: bool,
}

impl Token<'_> {
    fn is(&self, keyword: &str) -> bool {
        self.identifier && self.text.eq_ignore_ascii_case(keyword)
    }
}

fn quoted_end(bytes: &[u8], start: usize, quote: u8, backslashes: bool) -> usize {
    let mut index = start + 1;
    while index < bytes.len() {
        if backslashes && bytes[index] == b'\\' {
            index = (index + 2).min(bytes.len());
        } else if bytes[index] == quote {
            if bytes.get(index + 1) == Some(&quote) {
                index += 2;
            } else {
                return index + 1;
            }
        } else {
            index += 1;
        }
    }
    bytes.len()
}

fn block_end(bytes: &[u8], start: usize) -> usize {
    let mut index = start + 2;
    let mut depth = 1;
    while index + 1 < bytes.len() {
        if &bytes[index..index + 2] == b"/*" {
            depth += 1;
            index += 2;
        } else if &bytes[index..index + 2] == b"*/" {
            depth -= 1;
            index += 2;
            if depth == 0 {
                return index;
            }
        } else {
            index += 1;
        }
    }
    bytes.len()
}

fn tokens(statement: &str, kind: DatabaseKind) -> Vec<Token<'_>> {
    let bytes = statement.as_bytes();
    let mut result = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        let start = index;
        let mut identifier = false;
        match bytes[index] {
            byte if byte.is_ascii_whitespace() => {
                index += 1;
                continue;
            }
            b'-' if bytes.get(index + 1) == Some(&b'-') => {
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
                continue;
            }
            b'#' if kind == DatabaseKind::Mysql => {
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
                continue;
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                index = block_end(bytes, index);
                continue;
            }
            quote @ (b'\'' | b'"' | b'`') => {
                identifier = quote == b'`' || (quote == b'"' && kind == DatabaseKind::Postgresql);
                index = quoted_end(
                    bytes,
                    index,
                    quote,
                    kind == DatabaseKind::Mysql && quote != b'`',
                );
            }
            b'$' if kind == DatabaseKind::Postgresql => {
                let mut end = index + 1;
                while end < bytes.len()
                    && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_')
                {
                    end += 1;
                }
                if bytes.get(end) == Some(&b'$') {
                    let tag = &statement[index..=end];
                    index = statement[end + 1..]
                        .find(tag)
                        .map(|offset| end + 1 + offset + tag.len())
                        .unwrap_or(bytes.len());
                } else {
                    index += 1;
                }
            }
            byte if byte.is_ascii_alphanumeric() || byte == b'_' || byte >= 128 => {
                identifier = true;
                index += 1;
                while index < bytes.len()
                    && (bytes[index].is_ascii_alphanumeric()
                        || matches!(bytes[index], b'_' | b'$')
                        || bytes[index] >= 128)
                {
                    index += 1;
                }
            }
            _ => index += 1,
        }
        result.push(Token {
            text: &statement[start..index],
            start,
            end: index,
            identifier,
        });
    }
    result
}

/// MySQL dumps wrap real SQL in version comments. Expand only those outside literals;
/// otherwise the common splitter intentionally drops comment-only statements.
fn expand_mysql_comments(contents: &str) -> String {
    let bytes = contents.as_bytes();
    let mut output = String::new();
    let mut copied = 0;
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            quote @ (b'\'' | b'"' | b'`') => index = quoted_end(bytes, index, quote, quote != b'`'),
            b'-' if bytes.get(index + 1) == Some(&b'-') => {
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'#' => {
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                let end = block_end(bytes, index);
                let marker = if bytes.get(index + 2) == Some(&b'!') {
                    3
                } else if bytes.get(index + 2..index + 4) == Some(b"M!") {
                    4
                } else {
                    0
                };
                if marker > 0 && end >= index + marker + 2 && &bytes[end - 2..end] == b"*/" {
                    output.push_str(&contents[copied..index]);
                    output.push(' ');
                    let mut body = index + marker;
                    while body < end - 2 && bytes[body].is_ascii_digit() {
                        body += 1;
                    }
                    output.push_str(&contents[body..end - 2]);
                    output.push(' ');
                    copied = end;
                }
                index = end;
            }
            _ => index += 1,
        }
    }
    output.push_str(&contents[copied..]);
    output
}

fn database_statement(tokens: &[Token<'_>]) -> bool {
    let Some(first) = tokens.first() else {
        return false;
    };
    first.is("USE")
        || ((first.is("CREATE") || first.is("ALTER") || first.is("DROP"))
            && tokens
                .iter()
                .skip(1)
                .take(3)
                .any(|token| token.is("DATABASE") || token.is("SCHEMA")))
}

/// pg_dump restores SERIAL / IDENTITY counters with a SELECT setval call. Keep
/// only its literal form in data mode; arbitrary SELECT expressions can have
/// unrelated side effects and must not slip through this exception.
fn postgres_sequence_value(tokens: &[Token<'_>]) -> bool {
    fn identifier(token: Option<&Token<'_>>, name: &str) -> bool {
        token.is_some_and(|token| token.is(name) || token.text == format!("\"{name}\""))
    }
    fn punctuation(tokens: &[Token<'_>], index: &mut usize, value: &str) -> bool {
        if tokens.get(*index).is_some_and(|token| token.text == value) {
            *index += 1;
            true
        } else {
            false
        }
    }
    if !identifier(tokens.first(), "SELECT")
        || !identifier(tokens.get(1), "pg_catalog")
        || tokens.get(2).is_none_or(|token| token.text != ".")
        || !identifier(tokens.get(3), "setval")
    {
        return false;
    }
    let mut index = 4;
    if !punctuation(tokens, &mut index, "(") {
        return false;
    }
    let Some(sequence) = tokens.get(index) else {
        return false;
    };
    if !sequence.text.starts_with('\'') || !sequence.text.ends_with('\'') || sequence.text.len() < 2
    {
        return false;
    }
    index += 1;
    if punctuation(tokens, &mut index, ":") {
        if !punctuation(tokens, &mut index, ":") {
            return false;
        }
        if identifier(tokens.get(index), "pg_catalog") {
            index += 1;
            if !punctuation(tokens, &mut index, ".") {
                return false;
            }
        }
        if !identifier(tokens.get(index), "regclass") {
            return false;
        }
        index += 1;
    }
    if !punctuation(tokens, &mut index, ",") {
        return false;
    }
    let sign = if punctuation(tokens, &mut index, "-") {
        "-"
    } else {
        let _ = punctuation(tokens, &mut index, "+");
        ""
    };
    let Some(value) = tokens.get(index) else {
        return false;
    };
    if value.text.is_empty()
        || !value.text.bytes().all(|byte| byte.is_ascii_digit())
        || format!("{sign}{}", value.text).parse::<i64>().is_err()
    {
        return false;
    }
    index += 1;
    if punctuation(tokens, &mut index, ",") {
        if !tokens
            .get(index)
            .is_some_and(|token| token.is("true") || token.is("false"))
        {
            return false;
        }
        index += 1;
    }
    punctuation(tokens, &mut index, ")") && index == tokens.len()
}

/// Remove MySQL database qualifiers at object-reference positions. Strings, comments,
/// column qualifiers and PostgreSQL namespaces are deliberately left intact.
pub(super) fn current_database_sql(statement: &str, kind: DatabaseKind) -> String {
    if kind != DatabaseKind::Mysql {
        return statement.to_owned();
    }
    let tokens = tokens(statement, kind);
    let mut removals = Vec::new();
    let mut expect_object = false;
    let mut object_list = false;
    let mut index = 0;
    let index_or_trigger = tokens
        .iter()
        .take(8)
        .any(|token| token.is("INDEX") || token.is("TRIGGER"));
    let rename = tokens.first().is_some_and(|token| token.is("RENAME"));
    while index < tokens.len() {
        let token = &tokens[index];
        // SHOW CREATE VIEW commonly qualifies selected columns as db.table.column;
        // qualified function calls likewise need to follow the target database.
        let qualified = token.identifier
            && tokens.get(index + 1).is_some_and(|token| token.text == ".")
            && tokens.get(index + 2).is_some_and(|token| token.identifier);
        let qualified_column = tokens.get(index + 3).is_some_and(|token| token.text == ".")
            && tokens.get(index + 4).is_some_and(|token| token.identifier);
        let qualified_call = tokens.get(index + 3).is_some_and(|token| token.text == "(");
        if qualified && (qualified_column || qualified_call) {
            removals.push((token.start, tokens[index + 1].end));
            expect_object = false;
            index += 3;
            continue;
        }
        if expect_object {
            if [
                "IF",
                "NOT",
                "EXISTS",
                "LOW_PRIORITY",
                "HIGH_PRIORITY",
                "DELAYED",
                "IGNORE",
                "INTO",
                "ONLY",
                "TEMPORARY",
            ]
            .iter()
            .any(|word| token.is(word))
            {
                index += 1;
                continue;
            }
            if token.identifier
                && tokens.get(index + 1).is_some_and(|token| token.text == ".")
                && tokens.get(index + 2).is_some_and(|token| token.identifier)
            {
                removals.push((token.start, tokens[index + 1].end));
                index += 2;
            }
            expect_object = false;
        } else if [
            "TABLE",
            "TABLES",
            "FROM",
            "JOIN",
            "INTO",
            "UPDATE",
            "REFERENCES",
            "VIEW",
            "PROCEDURE",
            "FUNCTION",
            "TRIGGER",
            "EVENT",
        ]
        .iter()
        .any(|word| token.is(word))
            || ((token.is("INSERT") || token.is("REPLACE"))
                && !index
                    .checked_sub(1)
                    .and_then(|previous| tokens.get(previous))
                    .is_some_and(|token| token.is("OR"))
                && !tokens.get(index + 1).is_some_and(|token| token.text == "("))
            || (token.is("ON") && index_or_trigger)
            || (rename && token.is("TO"))
        {
            expect_object = true;
            object_list = true;
        } else if token.text == "," && object_list {
            expect_object = true;
        } else if token.text == "("
            || [
                "WHERE", "SET", "VALUES", "SELECT", "BEGIN", "RETURN", "ON", "GROUP", "ORDER",
                "LIMIT",
            ]
            .iter()
            .any(|word| token.is(word))
        {
            object_list = false;
        }
        index += 1;
    }
    let mut output = String::with_capacity(statement.len());
    let mut copied = 0;
    for (start, end) in removals {
        output.push_str(&statement[copied..start]);
        copied = end;
    }
    output.push_str(&statement[copied..]);
    output
}

/// Re-serialize complete statements using a collision-free client delimiter so a
/// routine body containing semicolons is still one statement in query::execute.
fn join_statements(statements: &[String], kind: DatabaseKind) -> String {
    if kind == DatabaseKind::Postgresql {
        return format!("{};\n", statements.join(";\n\n"));
    }
    let mut delimiter = "__MIRAIHUB_TRANSFER_END__".to_owned();
    while statements
        .iter()
        .any(|statement| statement.contains(&delimiter))
    {
        delimiter.push('_');
    }
    format!(
        "DELIMITER {delimiter}\n{}{delimiter}\nDELIMITER ;\n",
        statements.join(&format!("{delimiter}\n\n"))
    )
}

pub(super) fn prepare_import(
    contents: &str,
    kind: DatabaseKind,
    options: &DatabaseImportOptions,
) -> DatabaseResult<(String, usize)> {
    let contents = contents.trim_start_matches('\u{feff}');
    let expanded = if kind == DatabaseKind::Mysql {
        expand_mysql_comments(contents)
    } else {
        contents.to_owned()
    };
    let statements = sql::split_statements(&expanded, kind);
    let total = statements.len();
    let mut selected = Vec::new();
    let mut content_count = 0;
    for statement in statements {
        let tokens = tokens(&statement.text, kind);
        let Some(first) = tokens.first() else {
            continue;
        };
        if first.text == "\\" || (first.is("COPY") && tokens.iter().any(|token| token.is("STDIN")))
        {
            return Err(DatabaseError::InvalidInput("当前仅支持普通 SQL 文件；请使用 INSERT 格式导出，不要使用 COPY FROM STDIN 或客户端连接指令".into()));
        }
        let database = database_statement(&tokens);
        if database
            && (!options.include_database || options.content == DatabaseTransferContent::Data)
        {
            continue;
        }
        let data = first.is("INSERT")
            || first.is("REPLACE")
            || (kind == DatabaseKind::Postgresql && postgres_sequence_value(&tokens));
        let structure = ["CREATE", "ALTER", "DROP", "RENAME", "COMMENT"]
            .iter()
            .any(|word| first.is(word));
        let setup = ["SET", "RESET", "BEGIN", "START", "COMMIT", "ROLLBACK"]
            .iter()
            .any(|word| first.is(word));
        let keep = match options.content {
            DatabaseTransferContent::All => true,
            DatabaseTransferContent::Structure => structure || setup || database,
            DatabaseTransferContent::Data => data || setup,
        };
        if keep {
            if !setup {
                content_count += 1;
            }
            selected.push(
                if options.include_database && options.content != DatabaseTransferContent::Data {
                    statement.text
                } else {
                    current_database_sql(&statement.text, kind)
                },
            );
        }
    }
    if content_count == 0 {
        return Err(DatabaseError::InvalidInput(
            "SQL 文件中没有符合所选导入内容的语句".into(),
        ));
    }
    Ok((join_statements(&selected, kind), total - selected.len()))
}

/// 解开标识符的引号，仅用于表和列名；字符串常量从不经过此方法。
fn identifier(token: &Token<'_>) -> String {
    let text = token.text;
    if let Some(inner) = text
        .strip_prefix('`')
        .and_then(|value| value.strip_suffix('`'))
    {
        inner.replace("``", "`")
    } else if let Some(inner) = text
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
    {
        inner.replace("\"\"", "\"")
    } else {
        text.to_owned()
    }
}

/// 定位 INSERT/REPLACE 的目标表及可选字段清单，不处理值、注释中的相同文字。
fn insert_target(tokens: &[Token<'_>]) -> Option<(usize, usize, usize)> {
    if !tokens
        .first()
        .is_some_and(|t| t.is("INSERT") || t.is("REPLACE"))
    {
        return None;
    }
    let mut index = 1;
    while tokens.get(index).is_some_and(|t| {
        [
            "INTO",
            "LOW_PRIORITY",
            "HIGH_PRIORITY",
            "DELAYED",
            "IGNORE",
            "ONLY",
        ]
        .iter()
        .any(|word| t.is(word))
    }) {
        index += 1;
    }
    if !tokens.get(index).is_some_and(|t| t.identifier) {
        return None;
    }
    let last = if tokens.get(index + 1).is_some_and(|t| t.text == ".")
        && tokens.get(index + 2).is_some_and(|t| t.identifier)
    {
        index + 2
    } else {
        index
    };
    Some((index, last, last + 1))
}

/// 从建表语句取原始字段顺序，让没有字段清单的常见 mysqldump 也能按名称匹配。
fn create_columns(tokens: &[Token<'_>]) -> Option<(String, String, Vec<String>)> {
    if !tokens.first().is_some_and(|t| t.is("CREATE")) {
        return None;
    }
    let mut index = tokens.iter().position(|t| t.is("TABLE"))? + 1;
    while tokens
        .get(index)
        .is_some_and(|t| ["IF", "NOT", "EXISTS"].iter().any(|word| t.is(word)))
    {
        index += 1;
    }
    let first = tokens.get(index)?;
    let (schema, name) = if tokens.get(index + 1).is_some_and(|t| t.text == ".") {
        let pair = (identifier(first), identifier(tokens.get(index + 2)?));
        index += 3;
        pair
    } else {
        index += 1;
        (String::new(), identifier(first))
    };
    if !tokens.get(index).is_some_and(|t| t.text == "(") {
        return None;
    }
    let mut columns = Vec::new();
    let mut depth = 1;
    let mut at_column = true;
    for token in &tokens[index + 1..] {
        if token.text == ")" {
            depth -= 1;
            if depth == 0 {
                break;
            }
        }
        if depth == 1 && at_column {
            if token.identifier
                && ![
                    "PRIMARY",
                    "UNIQUE",
                    "KEY",
                    "INDEX",
                    "CONSTRAINT",
                    "FOREIGN",
                    "CHECK",
                    "FULLTEXT",
                    "SPATIAL",
                ]
                .iter()
                .any(|word| token.is(word))
            {
                columns.push(identifier(token));
            }
            at_column = false;
        }
        if token.text == "(" {
            depth += 1;
        }
        if depth == 1 && token.text == "," {
            at_column = true;
        }
    }
    Some((schema, name, columns))
}

/// 预览纯数据脚本中的源表和字段；只允许普通 VALUES 写入，复杂脚本保留给完整 SQL 导入。
pub(super) fn preview_data(
    contents: &str,
    kind: DatabaseKind,
) -> DatabaseResult<super::super::import_data::SqlImportPreview> {
    use super::super::import_data::{ImportSource, SqlImportPreview};
    let expanded = if kind == DatabaseKind::Mysql {
        expand_mysql_comments(contents.trim_start_matches('\u{feff}'))
    } else {
        contents.to_owned()
    };
    let statements = sql::split_statements(&expanded, kind);
    let definitions: Vec<_> = statements
        .iter()
        .filter_map(|s| create_columns(&tokens(&s.text, kind)))
        .collect();
    let mut sources: Vec<ImportSource> = Vec::new();
    let mut skipped = 0;
    for statement in &statements {
        let ts = tokens(&statement.text, kind);
        let Some((first, last, next)) = insert_target(&ts) else {
            skipped += 1;
            continue;
        };
        if !ts.iter().any(|t| t.is("VALUES")) || ts.iter().any(|t| t.is("SELECT")) {
            return Err(DatabaseError::InvalidInput(
                "纯数据匹配仅支持 INSERT/REPLACE ... VALUES，请使用普通 INSERT 格式的 SQL".into(),
            ));
        }
        let schema = if first != last {
            identifier(&ts[first])
        } else {
            String::new()
        };
        let name = identifier(&ts[last]);
        let mut columns = Vec::new();
        if ts.get(next).is_some_and(|t| t.text == "(") {
            let mut i = next + 1;
            while let Some(t) = ts.get(i) {
                if t.text == ")" {
                    break;
                }
                if !t.identifier {
                    return Err(DatabaseError::InvalidInput(
                        "无法识别 INSERT 字段清单".into(),
                    ));
                }
                columns.push(identifier(t));
                i += 1;
                if ts.get(i).is_some_and(|t| t.text == ",") {
                    i += 1;
                } else if !ts.get(i).is_some_and(|t| t.text == ")") {
                    return Err(DatabaseError::InvalidInput(
                        "无法识别 INSERT 字段清单".into(),
                    ));
                }
            }
        } else if let Some((_, _, defined)) = definitions
            .iter()
            .find(|(s, n, _)| *n == name && (s.is_empty() || schema.is_empty() || *s == schema))
        {
            columns = defined.clone();
        }
        if columns.is_empty() {
            return Err(DatabaseError::InvalidInput(format!("表 {name} 的 INSERT 没有字段名，也没有对应建表定义，无法可靠匹配；请重新导出并包含字段名")));
        }
        let unique: std::collections::BTreeSet<_> = columns.iter().collect();
        if unique.len() != columns.len() {
            return Err(DatabaseError::InvalidInput(format!(
                "表 {name} 包含重复字段"
            )));
        }
        let id = format!("{schema}\0{name}");
        if let Some(source) = sources.iter_mut().find(|s| s.id == id) {
            if columns.len() != source.columns.len()
                || columns
                    .iter()
                    .any(|column| !source.columns.contains(column))
            {
                return Err(DatabaseError::InvalidInput(format!(
                    "表 {name} 的多条 INSERT 字段清单不一致，请统一字段后再使用匹配导入"
                )));
            }
            source.statement_count += 1;
        } else {
            sources.push(ImportSource {
                id,
                schema,
                name,
                columns,
                rows: Vec::new(),
                statement_count: 1,
            });
        }
    }
    if sources.is_empty() {
        return Err(DatabaseError::InvalidInput(
            "SQL 文件没有可匹配的 INSERT/REPLACE 数据".into(),
        ));
    }
    Ok(SqlImportPreview {
        sources,
        skipped_statements: skipped,
    })
}

/// 用户确认后只替换语句的表名和字段标识符；值、注释和字符串保持原样，且禁止危险会话设置。
pub(super) fn mapped_data(
    contents: &str,
    kind: DatabaseKind,
    mappings: &[super::super::import_data::ImportMapping],
) -> DatabaseResult<(String, usize)> {
    let preview = preview_data(contents, kind)?;
    let expanded = if kind == DatabaseKind::Mysql {
        expand_mysql_comments(contents.trim_start_matches('\u{feff}'))
    } else {
        contents.to_owned()
    };
    let mut selected = Vec::new();
    for statement in sql::split_statements(&expanded, kind) {
        let ts = tokens(&statement.text, kind);
        let Some((first, last, next)) = insert_target(&ts) else {
            continue;
        };
        let schema = if first != last {
            identifier(&ts[first])
        } else {
            String::new()
        };
        let name = identifier(&ts[last]);
        let id = format!("{schema}\0{name}");
        let mapping = mappings
            .iter()
            .find(|m| m.source_id == id)
            .ok_or_else(|| DatabaseError::InvalidInput(format!("源表 {name} 缺少确认映射")))?;
        let source = preview.sources.iter().find(|s| s.id == id).unwrap();
        let mut edits = vec![(
            ts[first].start,
            ts[last].end,
            sql::qualified_name(&mapping.target_schema, &mapping.target_table, kind),
        )];
        if ts.get(next).is_some_and(|t| t.text == "(") {
            for token in &ts[next + 1..] {
                if token.text == ")" {
                    break;
                }
                if token.identifier {
                    let original = identifier(token);
                    let column = mapping.columns.get(&original).ok_or_else(|| {
                        DatabaseError::InvalidInput(format!("字段 {original} 缺少映射"))
                    })?;
                    edits.push((token.start, token.end, sql::quote_identifier(column, kind)));
                }
            }
        } else {
            let columns = source
                .columns
                .iter()
                .map(|name| {
                    mapping
                        .columns
                        .get(name)
                        .map(|column| sql::quote_identifier(column, kind))
                        .ok_or_else(|| DatabaseError::InvalidInput(format!("字段 {name} 缺少映射")))
                })
                .collect::<DatabaseResult<Vec<_>>>()?;
            edits.push((
                ts[last].end,
                ts[last].end,
                format!(" ({})", columns.join(", ")),
            ));
        }
        // ON DUPLICATE/CONFLICT 的表达式可能引用源列名，只允许字段名不变的情况。
        if ts.iter().any(|t| t.is("DUPLICATE") || t.is("CONFLICT"))
            && mapping.columns.iter().any(|(a, b)| a != b)
        {
            return Err(DatabaseError::InvalidInput(
                "带冲突处理的 SQL 不能重映射字段名，请保留原字段名或重新导出普通 INSERT".into(),
            ));
        }
        let mut output = String::new();
        let mut cursor = 0;
        for (start, end, value) in edits {
            output.push_str(&statement.text[cursor..start]);
            output.push_str(&value);
            cursor = end;
        }
        output.push_str(&statement.text[cursor..]);
        selected.push(output);
    }
    // setval 的序列名无法由表名可靠推导，避免映射到新表后修改旧序列。
    if kind == DatabaseKind::Postgresql && tokens(&expanded, kind).iter().any(|t| t.is("setval")) {
        return Err(DatabaseError::InvalidInput(
            "匹配导入暂不处理序列恢复，请移除 setval 语句后导入，或选择完整 SQL 导入".into(),
        ));
    }
    Ok((join_statements(&selected, kind), preview.skipped_statements))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn import(source: &str, kind: DatabaseKind, content: DatabaseTransferContent) -> Vec<String> {
        let (prepared, _) = prepare_import(
            source,
            kind,
            &DatabaseImportOptions {
                content,
                include_database: false,
                mappings: None,
            },
        )
        .unwrap();
        sql::split_statements(&prepared, kind)
            .into_iter()
            .map(|statement| statement.text)
            .collect()
    }

    fn mapping() -> super::super::super::import_data::ImportMapping {
        super::super::super::import_data::ImportMapping {
            source_id: "old\0users".into(),
            target_schema: "new".into(),
            target_table: "customers".into(),
            columns: [
                ("id".into(), "id".into()),
                ("name".into(), "display_name".into()),
            ]
            .into(),
        }
    }

    #[test]
    fn malformed_identifiers_and_inconsistent_columns_fail_without_panicking() {
        assert!(preview_data("INSERT INTO `中文", DatabaseKind::Mysql).is_err());
        assert!(preview_data(
            "INSERT INTO old.users(id,name) VALUES(1,'a'); INSERT INTO old.users(id) VALUES(2);",
            DatabaseKind::Mysql
        )
        .is_err());
        assert!(preview_data(
            "INSERT INTO old.users(id,id) VALUES(1,2)",
            DatabaseKind::Mysql
        )
        .is_err());
    }

    #[test]
    fn mapped_data_only_rewrites_identifiers_and_preserves_values() {
        let source = "CREATE DATABASE old; USE old; SET FOREIGN_KEY_CHECKS=0; INSERT INTO `old`.`users` (`id`,`name`) VALUES(1,'old.users; name INSERT INTO');";
        let (prepared, skipped) = mapped_data(source, DatabaseKind::Mysql, &[mapping()]).unwrap();
        assert_eq!(skipped, 3);
        assert!(prepared.contains("INSERT INTO `new`.`customers` (`id`,`display_name`) VALUES(1,'old.users; name INSERT INTO')"));
        assert!(!prepared.contains("FOREIGN_KEY_CHECKS"));
    }

    #[test]
    fn dump_without_insert_columns_uses_original_create_order() {
        let source = "CREATE TABLE old.users (`id` int, `name` varchar(20), PRIMARY KEY(id)); INSERT INTO old.users VALUES(1,'one'),(2,'two');";
        let preview = preview_data(source, DatabaseKind::Mysql).unwrap();
        assert_eq!(preview.sources[0].columns, vec!["id", "name"]);
        let (prepared, _) = mapped_data(source, DatabaseKind::Mysql, &[mapping()]).unwrap();
        assert!(prepared.contains("`customers` (`id`, `display_name`) VALUES"));
    }

    #[test]
    fn matching_rejects_unverifiable_or_incomplete_sources_before_execution() {
        assert!(preview_data("INSERT INTO users VALUES(1)", DatabaseKind::Mysql).is_err());
        assert!(preview_data(
            "INSERT INTO users(id) SELECT id FROM other",
            DatabaseKind::Mysql
        )
        .is_err());
        assert!(mapped_data(
            "INSERT INTO old.users(id,name) VALUES(1,'a'); INSERT INTO other(id) VALUES(2)",
            DatabaseKind::Mysql,
            &[mapping()]
        )
        .is_err());
        assert!(mapped_data("INSERT INTO old.users(id,name) VALUES(1,'a') ON DUPLICATE KEY UPDATE name=VALUES(name)",DatabaseKind::Mysql,&[mapping()]).is_err());
    }

    #[test]
    fn postgres_mapping_keeps_literal_and_quoted_schema_names() {
        let mut map = mapping();
        map.source_id = "Old.Schema\0User.Table".into();
        map.target_schema = "New.Schema".into();
        let source = "INSERT INTO \"Old.Schema\".\"User.Table\"(id,name) VALUES(1,$tag$Old.Schema.User.Table; name$tag$);";
        let (prepared, _) = mapped_data(source, DatabaseKind::Postgresql, &[map]).unwrap();
        assert!(prepared.contains("\"New.Schema\".\"customers\""));
        assert!(prepared.contains("$tag$Old.Schema.User.Table; name$tag$"));
    }

    #[test]
    fn data_only_skips_structure_switches_and_mutations() {
        let source = "CREATE DATABASE `old`; USE `old`; DROP TABLE t; CREATE TABLE t(id int); INSERT INTO `old`.`t` VALUES (1); UPDATE t SET id=2; DELETE FROM t; TRUNCATE t; CALL cleanup();";
        assert_eq!(
            import(source, DatabaseKind::Mysql, DatabaseTransferContent::Data),
            vec!["INSERT INTO `t` VALUES (1)"]
        );
    }

    #[test]
    fn insert_without_into_uses_current_database() {
        assert_eq!(
            import(
                "INSERT old.t VALUES (1); INSERT HIGH_PRIORITY IGNORE `old`.`t` VALUES (2);",
                DatabaseKind::Mysql,
                DatabaseTransferContent::Data
            ),
            vec![
                "INSERT t VALUES (1)",
                "INSERT HIGH_PRIORITY IGNORE `t` VALUES (2)"
            ]
        );
    }

    #[test]
    fn replace_without_into_uses_current_database() {
        assert_eq!(
            import(
                "REPLACE old.t VALUES (1); REPLACE LOW_PRIORITY `old`.`t` VALUES (2);",
                DatabaseKind::Mysql,
                DatabaseTransferContent::Data
            ),
            vec![
                "REPLACE t VALUES (1)",
                "REPLACE LOW_PRIORITY `t` VALUES (2)"
            ]
        );
        assert_eq!(
            current_database_sql("SELECT REPLACE(t.name, t.before, t.after), INSERT(t.name, 1, 2, t.other) FROM old.t t", DatabaseKind::Mysql),
            "SELECT REPLACE(t.name, t.before, t.after), INSERT(t.name, 1, 2, t.other) FROM t t"
        );
    }

    #[test]
    fn structure_only_skips_inserts_but_preserves_routine_body() {
        let source = "CREATE TABLE `old`.`t`(id int); INSERT INTO t VALUES(1);\nDELIMITER $$\nCREATE PROCEDURE `old`.`p`() BEGIN INSERT INTO `old`.`t` VALUES(2); SELECT 1; END$$\nDELIMITER ;\n";
        let result = import(
            source,
            DatabaseKind::Mysql,
            DatabaseTransferContent::Structure,
        );
        assert_eq!(result.len(), 2);
        assert!(
            result[1].contains("PROCEDURE `p`() BEGIN INSERT INTO `t` VALUES(2); SELECT 1; END")
        );
    }

    #[test]
    fn mysql_version_comments_are_filtered_as_sql() {
        let source = "/*!40101 SET NAMES utf8mb4 */; /*!50000 CREATE DATABASE hidden */; /* ordinary */ INSERT INTO `old`.`t` VALUES ('/*! DROP DATABASE x */');";
        let result = import(source, DatabaseKind::Mysql, DatabaseTransferContent::Data);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], "SET NAMES utf8mb4");
        assert!(result[1].contains("VALUES ('/*! DROP DATABASE x */')"));
    }

    #[test]
    fn current_database_rewrites_object_names_only() {
        let source = "/* `old`.`t` */ CREATE VIEW `old`.`v` AS SELECT t.id, 'old.t', `t`.`name` FROM `old`.`t` t JOIN `other`.`u` u ON t.id=u.id";
        assert_eq!(current_database_sql(source, DatabaseKind::Mysql), "/* `old`.`t` */ CREATE VIEW `v` AS SELECT t.id, 'old.t', `t`.`name` FROM `t` t JOIN `u` u ON t.id=u.id");
        assert_eq!(
            current_database_sql(
                "CREATE TABLE `old`.`t` (id int REFERENCES `old`.`u`(id))",
                DatabaseKind::Mysql
            ),
            "CREATE TABLE `t` (id int REFERENCES `u`(id))"
        );
    }

    #[test]
    fn qualified_view_columns_and_calls_use_the_current_database() {
        assert_eq!(
            current_database_sql(
                "CREATE OR REPLACE VIEW old.v AS SELECT * FROM old.t",
                DatabaseKind::Mysql
            ),
            "CREATE OR REPLACE VIEW v AS SELECT * FROM t"
        );
        assert_eq!(
            current_database_sql(
                "SELECT `old`.`t`.`id`, `old`.`format_name`(t.name) FROM `old`.`t` t",
                DatabaseKind::Mysql
            ),
            "SELECT `t`.`id`, `format_name`(t.name) FROM `t` t"
        );
    }

    #[test]
    fn postgres_namespaces_and_dollar_strings_survive() {
        let source = "CREATE SCHEMA app; CREATE TABLE app.t(id int); INSERT INTO app.t VALUES(1); CREATE FUNCTION app.f() RETURNS text AS $$ BEGIN RETURN 'INSERT INTO a.b;'; END; $$ LANGUAGE plpgsql;";
        let result = import(
            source,
            DatabaseKind::Postgresql,
            DatabaseTransferContent::Structure,
        );
        assert_eq!(result.len(), 2);
        assert!(result[0].contains("CREATE TABLE app.t"));
        assert!(result[1].contains("RETURN 'INSERT INTO a.b;'"));
    }

    #[test]
    fn postgres_data_import_restores_literal_sequence_values() {
        let source = "INSERT INTO public.t VALUES(1); SELECT pg_catalog.setval('public.t_id_seq', 1, true); SELECT pg_catalog.setval('public.other_seq'::regclass, 5); SELECT pg_catalog.setval('public.reverse_seq'::pg_catalog.regclass, -20, false);";
        let result = import(
            source,
            DatabaseKind::Postgresql,
            DatabaseTransferContent::Data,
        );
        assert_eq!(result.len(), 4);
        assert!(result[1].contains("setval('public.t_id_seq', 1, true)"));
        assert!(result[2].contains("setval('public.other_seq'::regclass, 5)"));
        assert!(result[3].contains("setval('public.reverse_seq'::pg_catalog.regclass, -20, false)"));
    }

    #[test]
    fn postgres_data_import_does_not_allow_other_select_expressions() {
        let source = "INSERT INTO public.t VALUES(1); SELECT other.setval('s',1,true); SELECT pg_catalog.setval('s', (SELECT 1), true); SELECT pg_catalog.setval('s', 1, true) + dangerous(); SELECT pg_catalog.setval('s' || dangerous(), 1, true); SELECT pg_catalog.setval('s', 1, true), dangerous(); SELECT dangerous();";
        assert_eq!(
            import(
                source,
                DatabaseKind::Postgresql,
                DatabaseTransferContent::Data
            ),
            vec!["INSERT INTO public.t VALUES(1)"]
        );
    }

    #[test]
    fn empty_selection_does_not_execute_session_settings() {
        assert!(prepare_import(
            "SET NAMES utf8mb4; CREATE TABLE t(id int);",
            DatabaseKind::Mysql,
            &DatabaseImportOptions {
                content: DatabaseTransferContent::Data,
                include_database: false,
                mappings: None,
            }
        )
        .is_err());
    }

    #[test]
    fn explicit_original_database_option_preserves_names() {
        let (prepared, skipped) = prepare_import(
            "CREATE DATABASE old; USE old; INSERT INTO old.t VALUES(1)",
            DatabaseKind::Mysql,
            &DatabaseImportOptions {
                content: DatabaseTransferContent::All,
                include_database: true,
                mappings: None,
            },
        )
        .unwrap();
        assert_eq!(skipped, 0);
        assert!(prepared.contains("INSERT INTO old.t"));
    }
}
