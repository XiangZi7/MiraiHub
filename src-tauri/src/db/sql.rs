//! SQL 文本处理：语句切分、标识符与字面量转义。
//!
//! 切分必须自己做，不能简单按 `;` split —— 分号会出现在字符串、注释和
//! PostgreSQL 的 dollar-quoted 块里。这里按方言逐字节扫描，只在真正的
//! 语句边界断开，并保留每条语句在原文中的偏移，前端据此定位报错语句。

use super::models::DatabaseKind;

/// 一条从原始输入里切出来的语句。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Statement {
    /// 去掉首尾空白后的语句文本，不含结尾分号。
    pub text: String,
    /// 在原始 SQL 中的起始字节偏移。
    pub offset: usize,
}

/// 按方言把一段 SQL 切成多条语句，跳过纯注释/纯空白的片段。
pub fn split_statements(sql: &str, kind: DatabaseKind) -> Vec<Statement> {
    let bytes = sql.as_bytes();
    let mut statements = Vec::new();
    let mut start = 0usize;
    let mut index = 0usize;
    let mut delimiter = b";".to_vec();

    while index < bytes.len() {
        if kind == DatabaseKind::Mysql {
            if let Some((next_delimiter, next_index)) = mysql_delimiter_directive(bytes, index) {
                // DELIMITER 是客户端指令，不应发送给服务端。指令之前通常只有
                // 空白或注释；若有可执行内容，仍按一条语句保留下来。
                push_statement(&mut statements, sql, start, index);
                delimiter = next_delimiter;
                index = next_index;
                start = next_index;
                continue;
            }
        }

        if !delimiter.is_empty() && bytes[index..].starts_with(&delimiter) {
            push_statement(&mut statements, sql, start, index);
            index += delimiter.len();
            start = index;
            continue;
        }

        match bytes[index] {
            b'-' if bytes.get(index + 1) == Some(&b'-') => index = skip_line(bytes, index + 2),
            // `#` 只在 MySQL 里是行注释；PostgreSQL 用它组成 jsonb 运算符（#> / #-）。
            b'#' if kind == DatabaseKind::Mysql => index = skip_line(bytes, index + 1),
            b'/' if bytes.get(index + 1) == Some(&b'*') => index = skip_block(bytes, index + 2),
            b'\'' => index = skip_quoted(bytes, index + 1, b'\'', kind),
            b'"' => index = skip_quoted(bytes, index + 1, b'"', kind),
            b'`' if kind == DatabaseKind::Mysql => {
                index = skip_quoted(bytes, index + 1, b'`', kind)
            }
            // dollar-quote 是 PostgreSQL 专有；MySQL 里 `$` 只是普通标识符字符。
            b'$' if kind == DatabaseKind::Postgresql => index = skip_dollar(bytes, index),
            _ => index += 1,
        }
    }

    push_statement(&mut statements, sql, start, bytes.len());
    statements
}

/// 识别 MySQL 客户端常用的 `DELIMITER $$` 行。服务端本身不认识该指令，
/// 但存储过程导入必须靠它避免把 BEGIN/END 内部的分号拆开。
fn mysql_delimiter_directive(bytes: &[u8], index: usize) -> Option<(Vec<u8>, usize)> {
    if index > 0 && bytes.get(index - 1) != Some(&b'\n') {
        return None;
    }

    let line_end = bytes[index..]
        .iter()
        .position(|byte| *byte == b'\n')
        .map(|offset| index + offset)
        .unwrap_or(bytes.len());
    let mut cursor = index;
    while cursor < line_end && matches!(bytes[cursor], b' ' | b'\t' | b'\r') {
        cursor += 1;
    }

    const DIRECTIVE: &[u8] = b"DELIMITER";
    if cursor + DIRECTIVE.len() > line_end
        || !bytes[cursor..cursor + DIRECTIVE.len()].eq_ignore_ascii_case(DIRECTIVE)
    {
        return None;
    }
    cursor += DIRECTIVE.len();
    if cursor >= line_end || !matches!(bytes[cursor], b' ' | b'\t') {
        return None;
    }
    while cursor < line_end && matches!(bytes[cursor], b' ' | b'\t') {
        cursor += 1;
    }
    let delimiter = bytes[cursor..line_end]
        .iter()
        .copied()
        .take_while(|byte| !matches!(byte, b' ' | b'\t' | b'\r'))
        .collect::<Vec<_>>();
    if delimiter.is_empty() {
        return None;
    }

    let next_index = if line_end < bytes.len() {
        line_end + 1
    } else {
        line_end
    };
    Some((delimiter, next_index))
}

fn push_statement(statements: &mut Vec<Statement>, sql: &str, start: usize, end: usize) {
    let slice = &sql[start..end];
    let trimmed = slice.trim();
    if trimmed.is_empty() || is_only_comments(trimmed) {
        return;
    }

    // offset 指向去掉前导空白后的真实起点，前端高亮出错语句时不会带上空行。
    let leading = slice.len() - slice.trim_start().len();
    statements.push(Statement {
        text: trimmed.to_owned(),
        offset: start + leading,
    });
}

/// 判断一个片段是否只有注释与空白 —— 这种片段不该被当作语句发给服务端。
fn is_only_comments(fragment: &str) -> bool {
    let bytes = fragment.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b' ' | b'\t' | b'\r' | b'\n' => index += 1,
            b'-' if bytes.get(index + 1) == Some(&b'-') => index = skip_line(bytes, index + 2),
            b'#' => index = skip_line(bytes, index + 1),
            b'/' if bytes.get(index + 1) == Some(&b'*') => index = skip_block(bytes, index + 2),
            _ => return false,
        }
    }

    true
}

fn skip_line(bytes: &[u8], from: usize) -> usize {
    let mut index = from;
    while index < bytes.len() && bytes[index] != b'\n' {
        index += 1;
    }
    index
}

fn skip_block(bytes: &[u8], from: usize) -> usize {
    let mut index = from;
    while index < bytes.len() {
        if bytes[index] == b'*' && bytes.get(index + 1) == Some(&b'/') {
            return index + 2;
        }
        index += 1;
    }
    bytes.len()
}

/// 跳过一段带引号的文本，返回收尾引号之后的位置。
/// 两种转义都要认：重复引号（`''`）通用，反斜杠只在 MySQL 默认模式下生效。
fn skip_quoted(bytes: &[u8], from: usize, quote: u8, kind: DatabaseKind) -> usize {
    let backslash_escapes = kind == DatabaseKind::Mysql && quote != b'`';
    let mut index = from;

    while index < bytes.len() {
        let byte = bytes[index];
        if backslash_escapes && byte == b'\\' {
            index += 2;
            continue;
        }
        if byte == quote {
            if bytes.get(index + 1) == Some(&quote) {
                index += 2;
                continue;
            }
            return index + 1;
        }
        index += 1;
    }

    bytes.len()
}

/// 跳过 `$tag$ ... $tag$`。不是合法 dollar-quote 起始（如占位符 `$1`）时只前进一个字节。
fn skip_dollar(bytes: &[u8], from: usize) -> usize {
    let Some(tag_end) = dollar_tag_end(bytes, from) else {
        return from + 1;
    };

    let tag = &bytes[from..tag_end];
    let mut index = tag_end;
    while index < bytes.len() {
        if bytes[index] == b'$' && bytes[index..].starts_with(tag) {
            return index + tag.len();
        }
        index += 1;
    }

    bytes.len()
}

/// `$` 开头能否读成一个 dollar-quote 标签，返回标签结束后的位置（含收尾 `$`）。
fn dollar_tag_end(bytes: &[u8], from: usize) -> Option<usize> {
    let mut index = from + 1;

    while index < bytes.len() {
        match bytes[index] {
            b'$' => return Some(index + 1),
            b'_' | b'a'..=b'z' | b'A'..=b'Z' => index += 1,
            // 标签首字符不能是数字，否则 `$1` 这类占位符会被误读成标签。
            b'0'..=b'9' if index > from + 1 => index += 1,
            _ => return None,
        }
    }

    None
}

/// 取语句的首个关键字，大写返回。用来判断是查询还是写入。
pub fn leading_keyword(statement: &str) -> String {
    statement
        .trim_start_matches(|c: char| c.is_whitespace() || c == '(')
        .split(|c: char| c.is_whitespace() || c == '(')
        .find(|word| !word.is_empty())
        .unwrap_or_default()
        .to_ascii_uppercase()
}

/// 转义标识符。MySQL 用反引号，PostgreSQL 用双引号，内部同名字符翻倍。
pub fn quote_identifier(identifier: &str, kind: DatabaseKind) -> String {
    match kind {
        DatabaseKind::Mysql => format!("`{}`", identifier.replace('`', "``")),
        DatabaseKind::Postgresql => format!("\"{}\"", identifier.replace('"', "\"\"")),
    }
}

/// `schema.name` 形式的限定名。schema 为空时只输出对象名。
pub fn qualified_name(schema: &str, name: &str, kind: DatabaseKind) -> String {
    if schema.trim().is_empty() {
        return quote_identifier(name, kind);
    }

    format!(
        "{}.{}",
        quote_identifier(schema, kind),
        quote_identifier(name, kind)
    )
}

/// 转义单引号字符串字面量。只用于拼 DDL 展示文本，不参与实际执行。
pub fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(sql: &str, kind: DatabaseKind) -> Vec<String> {
        split_statements(sql, kind)
            .into_iter()
            .map(|statement| statement.text)
            .collect()
    }

    #[test]
    fn splits_plain_statements() {
        assert_eq!(
            texts("SELECT 1; SELECT 2;", DatabaseKind::Mysql),
            vec!["SELECT 1", "SELECT 2"]
        );
    }

    #[test]
    fn keeps_semicolons_inside_strings() {
        assert_eq!(
            texts("SELECT ';'; SELECT 2", DatabaseKind::Postgresql),
            vec!["SELECT ';'", "SELECT 2"]
        );
    }

    #[test]
    fn handles_doubled_and_backslash_escapes() {
        assert_eq!(
            texts("SELECT 'it''s; fine'", DatabaseKind::Postgresql).len(),
            1
        );
        assert_eq!(texts(r"SELECT 'a\'; b'", DatabaseKind::Mysql).len(), 1);
    }

    #[test]
    fn skips_comments_and_empty_fragments() {
        let sql = "-- 只是注释\nSELECT 1; /* 块\n注释; */ ;\nSELECT 2";
        assert_eq!(texts(sql, DatabaseKind::Mysql).len(), 2);
    }

    #[test]
    fn hash_is_a_comment_only_in_mysql() {
        assert_eq!(texts("SELECT 1 # 注释; \n", DatabaseKind::Mysql).len(), 1);
        assert_eq!(
            texts("SELECT data #> '{a}'; SELECT 2", DatabaseKind::Postgresql).len(),
            2
        );
    }

    #[test]
    fn handles_dollar_quoted_bodies() {
        let sql = "CREATE FUNCTION f() RETURNS int AS $body$ BEGIN RETURN 1; END; $body$ LANGUAGE plpgsql; SELECT 1";
        assert_eq!(texts(sql, DatabaseKind::Postgresql).len(), 2);
    }

    #[test]
    fn handles_mysql_delimiter_routine_bodies() {
        let sql = "DELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND$$\nDELIMITER ;\nSELECT 3;";
        assert_eq!(
            texts(sql, DatabaseKind::Mysql),
            vec![
                "CREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND",
                "SELECT 3",
            ]
        );
    }

    #[test]
    fn positional_parameters_are_not_dollar_quotes() {
        assert_eq!(
            texts("SELECT $1; SELECT $2", DatabaseKind::Postgresql).len(),
            2
        );
    }

    #[test]
    fn records_offsets() {
        let statements = split_statements("SELECT 1;\n  SELECT 2", DatabaseKind::Mysql);
        assert_eq!(statements[0].offset, 0);
        assert_eq!(statements[1].offset, 12);
    }

    #[test]
    fn quotes_identifiers_per_dialect() {
        assert_eq!(quote_identifier("a`b", DatabaseKind::Mysql), "`a``b`");
        assert_eq!(
            quote_identifier("a\"b", DatabaseKind::Postgresql),
            "\"a\"\"b\""
        );
        assert_eq!(
            qualified_name("public", "users", DatabaseKind::Postgresql),
            "\"public\".\"users\""
        );
        assert_eq!(qualified_name("", "users", DatabaseKind::Mysql), "`users`");
    }

    #[test]
    fn reads_leading_keyword() {
        assert_eq!(leading_keyword("  select 1"), "SELECT");
        assert_eq!(leading_keyword("(SELECT 1)"), "SELECT");
        assert_eq!(leading_keyword("WITH x AS ()"), "WITH");
    }
}
