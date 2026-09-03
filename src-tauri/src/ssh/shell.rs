//! 远端 shell 命令的构造辅助。
//!
//! 系统信息采集与文件浏览都要把用户数据拼进命令字符串，
//! 转义逻辑只在这里实现一次，避免各处手写拼接漏掉某种情况。

/// 把任意字符串包成 POSIX shell 的单引号字面量。
///
/// 单引号内除了 `'` 本身，所有字符都失去特殊含义 ——
/// 空格、`$`、反引号、`;`、`&&` 一概按字面处理。
/// 遇到 `'` 就用 `'\''` 的经典写法闭合再拼接：
/// 结束当前引号、插入转义的单引号、重新开引号。
///
/// 路径来自前端（用户可以点进任意目录名），不转义就是命令注入。
pub fn quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('\'');

    for ch in value.chars() {
        if ch == '\'' {
            out.push_str(r"'\''");
        } else {
            out.push(ch);
        }
    }

    out.push('\'');
    out
}

/// 按 `@@name@@` 标记把一段输出切成若干节。
///
/// 采集系统信息时把十来条命令合并成一次 exec —— 每条单独 exec 都要开一个
/// SSH channel，一次轮询开十个来回，延迟高的链路上会很明显。
/// 合并后靠这些标记行把输出重新拆开。
pub fn split_sections(output: &str) -> Vec<(&str, &str)> {
    let mut sections = Vec::new();
    let mut current: Option<(&str, usize)> = None;

    for line in output.lines() {
        let trimmed = line.trim();

        let Some(name) = trimmed
            .strip_prefix("@@")
            .and_then(|rest| rest.strip_suffix("@@"))
        else {
            continue;
        };

        // 记录上一节的结束位置：标记行自身的起始偏移
        let marker_start = offset_of(output, line);

        if let Some((prev_name, prev_start)) = current {
            sections.push((prev_name, output[prev_start..marker_start].trim_end()));
        }

        current = Some((name, marker_start + line.len()));
    }

    if let Some((name, start)) = current {
        sections.push((name, output[start..].trim_end()));
    }

    sections
}

/// 子串在原串中的字节偏移。
///
/// `str::lines()` 返回的切片就借自原串，两者地址可以直接相减 ——
/// 比重新 find 一遍既快也不会匹配到内容相同的另一行。
fn offset_of(haystack: &str, needle: &str) -> usize {
    needle.as_ptr() as usize - haystack.as_ptr() as usize
}

/// 取某一节的内容。缺失时返回空串 —— 远端可能没有对应的文件或命令。
pub fn section<'a>(sections: &[(&'a str, &'a str)], name: &str) -> &'a str {
    sections
        .iter()
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.trim())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_plain_path() {
        assert_eq!(quote("/var/log"), "'/var/log'");
    }

    #[test]
    fn neutralizes_shell_metacharacters() {
        assert_eq!(quote("/tmp/a b"), "'/tmp/a b'");
        assert_eq!(quote("a; rm -rf /"), "'a; rm -rf /'");
        assert_eq!(quote("$(whoami)"), "'$(whoami)'");
    }

    #[test]
    fn escapes_embedded_single_quote() {
        // 结果是 'it'\''s'：闭合、转义引号、重开，拼起来正好是 it's
        assert_eq!(quote("it's"), r"'it'\''s'");
    }

    #[test]
    fn splits_marked_sections() {
        let output = "@@os@@\nUbuntu 22.04\n@@kernel@@\n5.15.0\n@@empty@@\n";
        let sections = split_sections(output);

        assert_eq!(section(&sections, "os"), "Ubuntu 22.04");
        assert_eq!(section(&sections, "kernel"), "5.15.0");
        assert_eq!(section(&sections, "empty"), "");
        assert_eq!(section(&sections, "missing"), "");
    }

    #[test]
    fn keeps_multiline_section_content() {
        let output = "@@mem@@\nMemTotal: 1\nMemFree: 2\n@@end@@\n";
        let sections = split_sections(output);
        assert_eq!(section(&sections, "mem"), "MemTotal: 1\nMemFree: 2");
    }
}
