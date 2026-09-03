//! 远端文件浏览。
//!
//! 用 `ls -lA` 解析而不是走 SFTP 子系统：russh 本身不带 SFTP 实现，
//! 引入 russh-sftp 会多一层依赖与协议状态机，而列目录这一个需求
//! 用 exec 就能覆盖。真要做上传下载时再上 SFTP 更合适。

use serde::{Deserialize, Serialize};

use super::error::{SshError, SshResult};
use super::session::SshSession;
use super::shell::quote;

/// 目录项类型。前端据此选图标，也决定双击是进目录还是打开文件。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    Directory,
    File,
    Symlink,
    /// 设备、管道、套接字等
    Other,
}

/// 一个目录项。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFile {
    /// 绝对路径，同时作为列表 key
    pub path: String,
    pub name: String,
    pub kind: FileKind,
    /// 字节数。目录的大小没有展示意义，但仍如实返回
    pub size: u64,
    /// 修改时间，Unix 毫秒
    pub modified_at: i64,
    /// 权限位，如 `rwxr-xr-x`
    pub permissions: String,
    pub owner: String,
    pub group: String,
    /// 符号链接指向的目标，仅 kind = symlink 时有值
    pub link_target: Option<String>,
}

/// 一次列目录的结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    /// 规范化后的绝对路径（`~` 已展开，`..` 已解析）
    pub path: String,
    pub entries: Vec<RemoteFile>,
}

/// 列出远端目录。
///
/// `path` 传空表示用户家目录。
pub async fn list_directory(session: &SshSession, path: &str) -> SshResult<DirectoryListing> {
    let target = if path.trim().is_empty() { "~" } else { path };

    // 先 cd 再 pwd：一次 exec 同时拿到规范化路径与目录内容，
    // 且 cd 失败时立刻退出，不会在错误的目录上执行 ls。
    //
    // ~ 不能加引号，否则 shell 不做展开，会当成名为 "~" 的目录。
    // 其余路径一律引号包裹，见 shell::quote 的说明。
    let quoted = if target == "~" {
        "~".to_owned()
    } else {
        quote(target)
    };

    // --time-style 固定成 ISO 长格式：ls 默认按 locale 和文件新旧
    // 输出两种不同格式（半年内带时间不带年，半年外带年不带时间），没法统一解析
    // fallback 只包住 ls：如果 cd 失败，整条命令必须失败。
    // 写成 `cd && pwd && ls || ls` 会在 cd 失败时去默认目录执行 fallback，
    // 前端最终看到的是一份来自错误目录、还把首个文件名当路径的伪成功结果。
    let command = format!(
        "cd {quoted} && {{ pwd; LC_ALL=C ls -lA --time-style=full-iso 2>/dev/null || \
         LC_ALL=C ls -lA; }}"
    );

    let output = session.exec(&command).await?;

    if output.exit_code.unwrap_or(0) != 0 {
        let reason = output.stderr.trim();
        let reason = if reason.is_empty() {
            format!("无法打开目录 {target}")
        } else {
            reason.to_owned()
        };

        return Err(SshError::InvalidInput(reason));
    }

    Ok(parse_listing(&output.stdout))
}

/// 解析 `pwd` + `ls -lA` 的合并输出。
fn parse_listing(stdout: &str) -> DirectoryListing {
    let mut lines = stdout.lines();

    // 第一行是 pwd 的输出
    let path = lines.next().unwrap_or("/").trim().to_owned();

    let entries = lines
        .filter(|line| !line.trim().is_empty())
        // ls 的首行 "total 123" 不是文件项
        .filter(|line| !line.starts_with("total "))
        .filter_map(|line| parse_entry(line, &path))
        .collect();

    DirectoryListing { path, entries }
}

/// 解析一行 `ls -lA --time-style=full-iso` 输出。
///
/// 格式：`-rw-r--r-- 1 user group 1234 2024-05-22 09:41:21.000000000 +0800 name`
/// 文件名可能含空格，所以逐个取走前面的定长字段，剩下的整体作为名字 ——
/// 简单 split_whitespace 取最后一段会把 "my notes.txt" 截成 "notes.txt"。
fn parse_entry(line: &str, dir: &str) -> Option<RemoteFile> {
    // perms links owner group size date time
    let (head, rest) = take_fields(line, 7)?;

    let permissions = head[0];
    let owner = head[2];
    let group = head[3];
    let size: u64 = head[4].parse().unwrap_or(0);

    // 第 8 个字段两种格式都有，但含义不同：
    // full-iso 里是时区（+0800），短格式里是时间（09:41）或年份（2023）。
    // 无论哪种，文件名都从它之后开始
    let (eighth, name_part) = next_field(rest)?;

    // full-iso 不被内核自带的 ls 支持时会退化成短格式，
    // 短格式没有年份信息，索性不猜时间，让前端显示为未知
    let modified_at = if is_timezone(eighth) {
        parse_iso_datetime(head[5], head[6], eighth)
    } else {
        0
    };

    // 符号链接的 " -> 目标" 要从名字里摘出来
    let (name, link_target) = match name_part.split_once(" -> ") {
        Some((name, target)) => (name, Some(target.trim_end().to_owned())),
        None => (name_part, None),
    };

    let name = name.trim_end();
    if name.is_empty() || name == "." || name == ".." {
        return None;
    }

    Some(RemoteFile {
        path: join_path(dir, name),
        name: name.to_owned(),
        kind: kind_of(permissions),
        size,
        modified_at,
        permissions: permissions.to_owned(),
        owner: owner.to_owned(),
        group: group.to_owned(),
        link_target,
    })
}

/// 取走开头的 `count` 个空白分隔字段，返回它们与剩余部分。
///
/// 不用 `splitn`：ls 为对齐会插入连续空格，
/// splitn 把中间的空字符串也算进分割次数，字段就错位了。
fn take_fields(line: &str, count: usize) -> Option<(Vec<&str>, &str)> {
    let mut fields = Vec::with_capacity(count);
    let mut rest = line;

    for _ in 0..count {
        let (field, tail) = next_field(rest)?;
        fields.push(field);
        rest = tail;
    }

    Some((fields, rest))
}

/// 取下一个字段与其后的剩余部分（已跳过前导空白）。
fn next_field(input: &str) -> Option<(&str, &str)> {
    let trimmed = input.trim_start();
    if trimmed.is_empty() {
        return None;
    }

    let end = trimmed.find(char::is_whitespace).unwrap_or(trimmed.len());

    Some((&trimmed[..end], trimmed[end..].trim_start()))
}

/// 是否是 `+0800` / `-0500` 这样的时区偏移。
fn is_timezone(field: &str) -> bool {
    field.len() == 5
        && matches!(field.as_bytes()[0], b'+' | b'-')
        && field[1..].bytes().all(|b| b.is_ascii_digit())
}

/// 权限串首字符决定类型。
fn kind_of(permissions: &str) -> FileKind {
    match permissions.chars().next() {
        Some('d') => FileKind::Directory,
        Some('l') => FileKind::Symlink,
        Some('-') => FileKind::File,
        _ => FileKind::Other,
    }
}

/// 拼接目录与文件名。根目录不重复斜杠。
fn join_path(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

/// 解析 `2024-05-22` + `09:41:21.000000000` + `+0800` 为 Unix 毫秒（UTC）。
///
/// 自己算而不是引入 chrono：只需要这一处日期解析，
/// 格式还是固定的 ISO，为它多一个依赖不划算。
fn parse_iso_datetime(date: &str, time: &str, timezone: &str) -> i64 {
    let mut date_parts = date.split('-');
    let year: i64 = date_parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let month: i64 = date_parts.next().and_then(|v| v.parse().ok()).unwrap_or(1);
    let day: i64 = date_parts.next().and_then(|v| v.parse().ok()).unwrap_or(1);

    if year == 0 {
        return 0;
    }

    // 小数秒直接丢掉，毫秒精度对文件列表没有意义
    let time = time.split('.').next().unwrap_or(time);
    let mut time_parts = time.split(':');
    let hour: i64 = time_parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let minute: i64 = time_parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let second: i64 = time_parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);

    let days = days_from_civil(year, month, day);

    let local_seconds = days * 86400 + hour * 3600 + minute * 60 + second;

    // `+0800` 表示本地时间比 UTC 快 8 小时，因此换算成 UTC 要减去偏移。
    // 字段在调用前已由 is_timezone 校验，这里仍用安全解析，异常时按 UTC 兜底。
    let offset_sign = if timezone.starts_with('-') { -1 } else { 1 };
    let offset_hours = timezone
        .get(1..3)
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    let offset_minutes = timezone
        .get(3..5)
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    let offset_seconds = offset_sign * (offset_hours * 3600 + offset_minutes * 60);

    (local_seconds - offset_seconds) * 1000
}

/// 公历日期 → 距 1970-01-01 的天数。
///
/// Howard Hinnant 的 days_from_civil 算法：把 3 月当作年首，
/// 闰日就落在年尾，闰年判断不必再分情况讨论。
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;

    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;

    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_iso_entry() {
        let line =
            "-rw-r--r-- 1 ubuntu ubuntu 2048 2024-05-22 09:41:21.000000000 +0800 package.json";
        let entry = parse_entry(line, "/home/ubuntu").unwrap();

        assert_eq!(entry.name, "package.json");
        assert_eq!(entry.path, "/home/ubuntu/package.json");
        assert_eq!(entry.kind, FileKind::File);
        assert_eq!(entry.size, 2048);
        assert_eq!(entry.owner, "ubuntu");
        assert!(entry.modified_at > 0);
    }

    #[test]
    fn parses_directory() {
        let line = "drwxr-xr-x 4 root root 4096 2024-05-20 18:30:00.000000000 +0000 logs";
        let entry = parse_entry(line, "/var").unwrap();

        assert_eq!(entry.kind, FileKind::Directory);
        assert_eq!(entry.path, "/var/logs");
    }

    #[test]
    fn extracts_symlink_target() {
        let line = "lrwxrwxrwx 1 root root 7 2024-05-20 18:30:00.000000000 +0000 sh -> dash";
        let entry = parse_entry(line, "/bin").unwrap();

        assert_eq!(entry.kind, FileKind::Symlink);
        assert_eq!(entry.name, "sh");
        assert_eq!(entry.link_target.as_deref(), Some("dash"));
    }

    /// 文件名里的空格不能把字段切错位
    #[test]
    fn keeps_spaces_in_filename() {
        let line = "-rw-r--r-- 1 u g 10 2024-05-22 09:41:21.000000000 +0800 my notes.txt";
        let entry = parse_entry(line, "/tmp").unwrap();

        assert_eq!(entry.name, "my notes.txt");
        assert_eq!(entry.path, "/tmp/my notes.txt");
    }

    /// 老版 ls 不认 --time-style，退化成短格式时至少要把名字取对
    #[test]
    fn handles_short_date_format() {
        let line = "-rw-r--r-- 1 u g 10 May 22 09:41 readme.md";
        let entry = parse_entry(line, "/tmp").unwrap();

        assert_eq!(entry.name, "readme.md");
        assert_eq!(entry.modified_at, 0);
    }

    #[test]
    fn skips_total_line_and_dot_entries() {
        let stdout = "/home/ubuntu\ntotal 24\n\
                      drwxr-xr-x 2 u g 4096 2024-05-22 09:41:21.000000000 +0800 .\n\
                      -rw-r--r-- 1 u g 10 2024-05-22 09:41:21.000000000 +0800 a.txt\n";
        let listing = parse_listing(stdout);

        assert_eq!(listing.path, "/home/ubuntu");
        assert_eq!(listing.entries.len(), 1);
        assert_eq!(listing.entries[0].name, "a.txt");
    }

    #[test]
    fn joins_root_without_double_slash() {
        assert_eq!(join_path("/", "etc"), "/etc");
        assert_eq!(join_path("/home", "user"), "/home/user");
    }

    #[test]
    fn converts_epoch_correctly() {
        // 1970-01-01 00:00:00 是 0
        assert_eq!(parse_iso_datetime("1970-01-01", "00:00:00", "+0000"), 0);
        // 1970-01-02 00:00:00 是 86400 秒
        assert_eq!(
            parse_iso_datetime("1970-01-02", "00:00:00", "+0000"),
            86_400_000
        );
        // 2024-05-22 09:41:21 +0800 = 2024-05-22 01:41:21 UTC
        assert_eq!(
            parse_iso_datetime("2024-05-22", "09:41:21.000000000", "+0800"),
            1_716_342_081_000
        );
    }
}
