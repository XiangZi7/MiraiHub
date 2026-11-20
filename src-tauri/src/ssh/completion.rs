//! 交互式终端的命令与路径补全。
//!
//! 探测只使用独立 exec channel，不向 PTY 注入命令；会话内缓存和按资源加锁
//! 合并连续按键产生的请求。候选 value 是可整体替换原始 token 的安全 shell 文本。

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::hash::Hash;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::{Mutex, Semaphore};
use tokio::time::Instant;

use super::error::SshResult;
use super::session::SshSession;
use super::shell::quote;

const COMMAND_TTL: Duration = Duration::from_secs(30);
const DIRECTORY_TTL: Duration = Duration::from_secs(2);
const FAILURE_TTL: Duration = Duration::from_millis(400);
const SOURCE_BUDGET: Duration = Duration::from_millis(2500);
const EXEC_BUDGET: Duration = Duration::from_secs(2);
const CLOSE_BUDGET: Duration = Duration::from_millis(500);
const MAX_CACHED_KEYS: usize = 32;
const MAX_COMMAND_NAMES: usize = 16384;
const MAX_DIRECTORY_NAMES: usize = 4096;
const MAX_COMMAND_SUGGESTIONS: usize = 8;
const MAX_PATH_SUGGESTIONS: usize = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSuggestion {
    pub value: String,
    pub label: String,
    pub kind: SuggestionKind,
    pub description: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SuggestionKind {
    Command,
    Directory,
    File,
}

/// 随 SSH 会话创建和销毁，避免主机、用户或重连之间复用补全数据。
pub(super) struct CompletionCache {
    commands: CachedProbe<CommandCatalog>,
    command_prefixes: Mutex<HashMap<String, ProbeSlot<CommandCatalog>>>,
    directories: Mutex<HashMap<DirectoryKey, ProbeSlot<DirectoryCatalog>>>,
    slots: Semaphore,
}

impl Default for CompletionCache {
    /// 创建会话独占的缓存和两个探测额度，保留交互终端及文件传输的通道容量。
    fn default() -> Self {
        Self {
            commands: CachedProbe::default(),
            command_prefixes: Mutex::new(HashMap::new()),
            directories: Mutex::new(HashMap::new()),
            slots: Semaphore::new(2),
        }
    }
}

struct CachedValue<T> {
    value: Option<Arc<T>>,
    expires_at: Instant,
}

struct CachedProbe<T> {
    state: Mutex<Option<CachedValue<T>>>,
}

impl<T> Default for CachedProbe<T> {
    /// 创建尚未探测的资源；独立互斥锁只合并相同资源的远端请求。
    fn default() -> Self {
        Self {
            state: Mutex::new(None),
        }
    }
}

impl<T> CachedProbe<T> {
    /// 在同一时限内等待已有探测或刷新缓存；失败短缓存，避免慢链路持续排队。
    async fn get_or_fetch<F, Fut>(
        &self,
        ttl: Duration,
        deadline: Instant,
        fetch: F,
    ) -> Option<Arc<T>>
    where
        F: FnOnce(Instant) -> Fut,
        Fut: Future<Output = Option<T>>,
    {
        let mut state = tokio::time::timeout_at(deadline, self.state.lock())
            .await
            .ok()?;
        if let Some(cached) = state.as_ref() {
            if cached.expires_at > Instant::now() {
                return cached.value.clone();
            }
        }
        let value = tokio::time::timeout_at(deadline, fetch(deadline))
            .await
            .ok()
            .flatten()
            .map(Arc::new);
        let lifetime = if value.is_some() { ttl } else { FAILURE_TTL };
        *state = Some(CachedValue {
            value: value.clone(),
            expires_at: Instant::now() + lifetime,
        });
        value
    }
}

struct ProbeSlot<T> {
    probe: Arc<CachedProbe<T>>,
    last_used: Instant,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct DirectoryTarget {
    path: String,
    home: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct DirectoryKey {
    target: DirectoryTarget,
    prefix: String,
}

struct CommandCatalog {
    names: Vec<String>,
    truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PathEntry {
    name: String,
    directory: bool,
}

struct DirectoryCatalog {
    entries: Vec<PathEntry>,
    truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CurrentToken {
    value: String,
    command_position: bool,
    home: bool,
}

/// 取得有界的资源缓存；只淘汰空闲项，正在探测或等待的同键请求始终共享锁。
async fn cached_slot<K, T>(
    slots: &Mutex<HashMap<K, ProbeSlot<T>>>,
    key: K,
) -> Option<Arc<CachedProbe<T>>>
where
    K: Eq + Hash + Clone,
{
    let mut slots = slots.lock().await;
    if let Some(slot) = slots.get_mut(&key) {
        slot.last_used = Instant::now();
        return Some(slot.probe.clone());
    }
    if slots.len() >= MAX_CACHED_KEYS {
        let oldest = slots
            .iter()
            .filter(|(_, slot)| Arc::strong_count(&slot.probe) == 1)
            .min_by_key(|(_, slot)| slot.last_used)
            .map(|(key, _)| key.clone())?;
        slots.remove(&oldest);
    }
    let probe = Arc::new(CachedProbe::default());
    slots.insert(
        key,
        ProbeSlot {
            probe: probe.clone(),
            last_used: Instant::now(),
        },
    );
    Some(probe)
}

/// 并行查询命令和路径；某个来源失败或超时不丢弃另一来源的候选，也不污染 PTY。
pub async fn suggestions(
    session: &SshSession,
    line: &str,
    cwd: &str,
) -> SshResult<Vec<ShellSuggestion>> {
    let Some(token) = current_token(line) else {
        return Ok(Vec::new());
    };
    if token.value.is_empty() && token.command_position {
        return Ok(Vec::new());
    }

    let commands = async {
        if token.command_position && !looks_like_path(&token.value) {
            command_suggestions(session, &token.value).await
        } else {
            Vec::new()
        }
    };
    let (mut results, paths) = tokio::join!(commands, path_suggestions(session, &token, cwd));
    results.extend(paths);
    let mut seen = HashSet::new();
    results.retain(|item| seen.insert((item.kind_label(), item.value.clone())));
    results.truncate(12);
    Ok(results)
}

/// 获取限时的独立 exec 输出；为关闭通道预留时间，不继承默认三十秒等待。
async fn probe_stdout(session: &SshSession, command: &str, deadline: Instant) -> Option<String> {
    let _permit = tokio::time::timeout_at(deadline, session.completion.slots.acquire())
        .await
        .ok()?
        .ok()?;
    let limit = deadline
        .saturating_duration_since(Instant::now())
        .saturating_sub(CLOSE_BUDGET)
        .min(EXEC_BUDGET);
    if limit.is_zero() {
        return None;
    }
    let output = session.exec_timeout(command, limit).await.ok()?;
    if output.exit_code.unwrap_or(0) != 0 {
        return None;
    }
    Some(output.stdout)
}

/// 构造非 login bash 的命令目录探测；按前缀回退时用户输入经过两层单引号转义。
fn command_probe(prefix: &str) -> String {
    let inner = format!(
        "compgen -c -- {} 2>/dev/null | LC_ALL=C sort -u | head -n {}",
        quote(prefix),
        MAX_COMMAND_NAMES + 1,
    );
    format!(
        "env BASH_ENV= ENV= bash --noprofile --norc -c {}",
        quote(&inner)
    )
}

/// 解析命令目录并保留截断标志，不能把全量目录的尾部遗漏当成不存在。
fn parse_command_catalog(stdout: &str) -> CommandCatalog {
    let mut names = stdout
        .split('\n')
        .filter(|name| suggestible_name(name))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    let truncated = stdout.split('\n').filter(|name| !name.is_empty()).count() > MAX_COMMAND_NAMES;
    names.truncate(MAX_COMMAND_NAMES);
    CommandCatalog { names, truncated }
}

/// 本地过滤缓存的命令目录；目录截断且匹配不足时只对该前缀补一次限时探测。
async fn command_suggestions(session: &SshSession, prefix: &str) -> Vec<ShellSuggestion> {
    let deadline = Instant::now() + SOURCE_BUDGET;
    let Some(catalog) = session
        .completion
        .commands
        .get_or_fetch(COMMAND_TTL, deadline, |deadline| async move {
            probe_stdout(session, &command_probe(""), deadline)
                .await
                .map(|stdout| parse_command_catalog(&stdout))
        })
        .await
    else {
        return Vec::new();
    };
    let mut matches = command_candidates(&catalog.names, prefix);
    if catalog.truncated && matches.len() < MAX_COMMAND_SUGGESTIONS {
        if let Some(probe) =
            cached_slot(&session.completion.command_prefixes, prefix.to_owned()).await
        {
            if let Some(filtered) = probe
                .get_or_fetch(COMMAND_TTL, deadline, |deadline| async move {
                    probe_stdout(session, &command_probe(prefix), deadline)
                        .await
                        .map(|stdout| parse_command_catalog(&stdout))
                })
                .await
            {
                matches = command_candidates(&filtered.names, prefix);
            }
        }
    }
    matches
}

/// 把匹配的命令名称转换为可安全替换整个 token 的候选。
fn command_candidates(names: &[String], prefix: &str) -> Vec<ShellSuggestion> {
    names
        .iter()
        .filter(|name| name.starts_with(prefix))
        .take(MAX_COMMAND_SUGGESTIONS)
        .map(|name| ShellSuggestion {
            value: shell_value(name, false),
            label: name.clone(),
            kind: SuggestionKind::Command,
            description: command_description(name).to_owned(),
        })
        .collect()
}

/// 用 POSIX shell glob 和 NUL 分隔结果列目录，避免 ls 的空格、引用与软链文本解析。
fn directory_probe(target: &DirectoryTarget, prefix: &str) -> String {
    let quoted = if target.home {
        match target.path.strip_prefix("~/") {
            Some(relative) => format!("\"$HOME\"/{}", quote(relative)),
            None => "\"$HOME\"".to_owned(),
        }
    } else {
        quote(&target.path)
    };
    // glob 仅来自固定脚本；case 只生成固定 ASCII 大小写类，非字母前缀被单引号引用。
    // -d 跟随目录软链，断链仍由 -L 保留。CDPATH 清空，避免 cd 额外打印目录。
    let inner = format!(
        "CDPATH= cd -- {quoted} && {{ LC_ALL=C; export LC_ALL; count=0; \
         printf '\\000'; for entry in .[!.]* ..?* *; do \
         [ -e \"$entry\" ] || [ -L \"$entry\" ] || continue; \
         case \"$entry\" in {}*) ;; *) continue ;; esac; \
         if [ -d \"$entry\" ]; then kind=d; else kind=f; fi; \
         printf '%s\\000%s\\000' \"$kind\" \"$entry\"; count=$((count + 1)); \
         if [ \"$count\" -ge {} ]; then break; fi; done; :; }}",
        ascii_case_prefix(prefix),
        MAX_DIRECTORY_NAMES + 1,
    );
    // 显式选择 POSIX sh，避免用户登录 shell 是 fish/zsh 时改变 glob 或脚本语法。
    format!("env BASH_ENV= ENV= sh -c {}", quote(&inner))
}

/// 构造只扩展固定 ASCII 字母大小写的 case 前缀，其余输入整体引用为字面模式。
fn ascii_case_prefix(prefix: &str) -> String {
    let mut pattern = String::new();
    let mut literal = String::new();
    for ch in prefix.chars() {
        if ch.is_ascii_alphabetic() {
            if !literal.is_empty() {
                pattern.push_str(&quote(&literal));
                literal.clear();
            }
            pattern.push('[');
            pattern.push(ch.to_ascii_lowercase());
            pattern.push(ch.to_ascii_uppercase());
            pattern.push(']');
        } else {
            literal.push(ch);
        }
    }
    if !literal.is_empty() || pattern.is_empty() {
        pattern.push_str(&quote(&literal));
    }
    pattern
}

/// 解析目录的类型/名称对；拒绝控制字符，防止候选作为终端输入改变 PTY 状态。
fn parse_directory_catalog(stdout: &str) -> DirectoryCatalog {
    let mut fields = stdout.split('\0').skip(1);
    let mut entries = Vec::new();
    let mut count = 0;
    while let (Some(kind), Some(name)) = (fields.next(), fields.next()) {
        if !matches!(kind, "d" | "f") {
            continue;
        }
        count += 1;
        if suggestible_name(name) {
            entries.push(PathEntry {
                name: name.to_owned(),
                directory: kind == "d",
            });
        }
        if count > MAX_DIRECTORY_NAMES {
            break;
        }
    }
    let truncated = count > MAX_DIRECTORY_NAMES;
    entries.truncate(MAX_DIRECTORY_NAMES);
    DirectoryCatalog { entries, truncated }
}

/// 读取父目录的短期缓存；超大目录按前缀回退，但所有探测仍共用首次查询时限。
async fn path_suggestions(
    session: &SshSession,
    token: &CurrentToken,
    cwd: &str,
) -> Vec<ShellSuggestion> {
    let deadline = Instant::now() + SOURCE_BUDGET;
    let (directory_part, prefix) = if token.home && token.value == "~" {
        ("~/", "")
    } else {
        split_path_token(&token.value)
    };
    let target = directory_target(directory_part, cwd, token.home);
    let key = DirectoryKey {
        target: target.clone(),
        prefix: String::new(),
    };
    let Some(probe) = cached_slot(&session.completion.directories, key).await else {
        return Vec::new();
    };
    // 异步块按值捕获截止时间和目录借用，不搬走截断回退仍需使用的 target。
    let target_ref = &target;
    let Some(catalog) = probe
        .get_or_fetch(DIRECTORY_TTL, deadline, |deadline| async move {
            probe_stdout(session, &directory_probe(target_ref, ""), deadline)
                .await
                .map(|stdout| parse_directory_catalog(&stdout))
        })
        .await
    else {
        return Vec::new();
    };
    let mut matches = path_candidates(&catalog.entries, directory_part, prefix, token.home);
    if catalog.truncated && !prefix.is_empty() && matches.len() < MAX_PATH_SUGGESTIONS {
        let key = DirectoryKey {
            target: target.clone(),
            prefix: prefix.to_owned(),
        };
        if let Some(probe) = cached_slot(&session.completion.directories, key).await {
            if let Some(filtered) = probe
                .get_or_fetch(DIRECTORY_TTL, deadline, |deadline| async move {
                    probe_stdout(session, &directory_probe(target_ref, prefix), deadline)
                        .await
                        .map(|stdout| parse_directory_catalog(&stdout))
                })
                .await
            {
                matches = path_candidates(&filtered.entries, directory_part, prefix, token.home);
            }
        }
    }
    matches
}

/// 不区分大小写匹配并保留远端真实拼写，目录优先；隐藏项仅在用户输入点前缀时显示。
fn path_candidates(
    entries: &[PathEntry],
    directory_part: &str,
    prefix: &str,
    home: bool,
) -> Vec<ShellSuggestion> {
    let prefix_lower = prefix.to_lowercase();
    let mut entries = entries
        .iter()
        .filter(|entry| entry.name.to_lowercase().starts_with(&prefix_lower))
        .filter(|entry| !entry.name.starts_with('.') || prefix.starts_with('.'))
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| a.name.cmp(&b.name))
    });
    entries
        .into_iter()
        .take(MAX_PATH_SUGGESTIONS)
        .map(|entry| {
            let suffix = if entry.directory { "/" } else { "" };
            ShellSuggestion {
                value: shell_value(&format!("{directory_part}{}{suffix}", entry.name), home),
                label: entry.name.clone(),
                kind: if entry.directory {
                    SuggestionKind::Directory
                } else {
                    SuggestionKind::File
                },
                description: if entry.directory {
                    "远端目录"
                } else {
                    "远端文件"
                }
                .to_owned(),
            }
        })
        .collect()
}

/// 扫描当前 shell 单词，解码单双引号/反斜杠；只分析字面量，不执行任何展开。
fn current_token(line: &str) -> Option<CurrentToken> {
    let mut chars = line.char_indices().peekable();
    let mut value = String::new();
    let mut start = None;
    let mut quoted = None;
    let mut command_position = true;
    while let Some((index, ch)) = chars.next() {
        if ch.is_control() && !matches!(ch, '\t' | '\n' | '\r') {
            return None;
        }
        if quoted == Some('\'') {
            if ch == '\'' {
                quoted = None;
            } else {
                value.push(ch);
            }
            continue;
        }
        if quoted == Some('"') {
            match ch {
                '"' => quoted = None,
                '$' | '`' => return None,
                '\\' => {
                    if let Some(&(_, next)) = chars.peek() {
                        if matches!(next, '$' | '`' | '"' | '\\' | '\n') {
                            chars.next();
                            if next != '\n' {
                                value.push(next);
                            }
                        } else {
                            value.push('\\');
                        }
                    }
                }
                _ => value.push(ch),
            }
            continue;
        }
        if ch.is_whitespace() || matches!(ch, ';' | '|' | '&' | '<' | '>' | '(' | ')') {
            if matches!(ch, ';' | '|' | '&' | '(' | ')' | '\n' | '\r') {
                command_position = true;
            } else if start.is_some() || matches!(ch, '<' | '>') {
                command_position = false;
            }
            value.clear();
            start = None;
            continue;
        }
        let token_start = *start.get_or_insert(index);
        match ch {
            '\'' | '"' => quoted = Some(ch),
            '\\' => {
                if let Some((_, next)) = chars.next() {
                    if next != '\n' {
                        if next.is_control() && next != '\t' {
                            return None;
                        }
                        value.push(next);
                    }
                }
            }
            '$' | '`' | '*' | '?' | '[' | ']' | '{' | '}' => return None,
            '#' if index == token_start => return None,
            '=' if command_position => return None,
            _ => value.push(ch),
        }
    }
    if value.chars().any(char::is_control) {
        return None;
    }
    let raw = start.map(|start| &line[start..]).unwrap_or("");
    let home = raw == "~" || raw.starts_with("~/");
    if raw.starts_with('~') && !home {
        return None;
    }
    Some(CurrentToken {
        value,
        command_position,
        home,
    })
}

/// 判断 token 是否明确指向路径，避免对路径前缀再执行命令目录查询。
fn looks_like_path(token: &str) -> bool {
    token.contains('/') || token.starts_with('.') || token.starts_with('~')
}

/// 把已经解码的 token 拆为父目录与名称前缀，保留目录末尾的斜杠用于替换。
fn split_path_token(token: &str) -> (&str, &str) {
    match token.rsplit_once('/') {
        Some((_directory, prefix)) => {
            let directory_end = token.len() - prefix.len();
            (&token[..directory_end], prefix)
        }
        None => ("", token),
    }
}

/// 将字面父目录与当前目录组合成缓存键；只有已识别的裸 ~/ 或默认家目录展开 HOME。
fn directory_target(directory_part: &str, cwd: &str, home: bool) -> DirectoryTarget {
    let directory = directory_part.trim_end_matches('/');
    if home {
        return DirectoryTarget {
            path: if directory.is_empty() { "~" } else { directory }.to_owned(),
            home: true,
        };
    }
    if directory_part.starts_with('/') {
        return DirectoryTarget {
            path: if directory.is_empty() { "/" } else { directory }.to_owned(),
            home: false,
        };
    }
    let cwd_home = cwd.is_empty() || matches!(cwd, "~" | "~/");
    if cwd_home {
        return DirectoryTarget {
            path: if directory.is_empty() {
                "~".to_owned()
            } else {
                format!("~/{directory}")
            },
            home: true,
        };
    }
    let path = if directory.is_empty() {
        cwd.trim_end_matches('/').to_owned()
    } else {
        format!("{}/{directory}", cwd.trim_end_matches('/'))
    };
    DirectoryTarget {
        path: if path.is_empty() {
            "/".to_owned()
        } else if path.starts_with('/') || path.starts_with("./") || path.starts_with("../") {
            path
        } else {
            format!("./{path}")
        },
        home: false,
    }
}

/// 返回完整安全 shell 单词；保留原始裸 HOME 前缀，其余特殊字符整体单引号引用。
fn shell_value(value: &str, home: bool) -> String {
    if home {
        if value == "~" {
            return "~".to_owned();
        }
        if let Some(relative) = value.strip_prefix("~/") {
            return if relative.is_empty() {
                "~/".to_owned()
            } else {
                format!("~/{}", shell_value(relative, false))
            };
        }
    }
    if !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "_@%+:,./-".contains(ch))
    {
        value.to_owned()
    } else {
        quote(value)
    }
}

/// 排除无法作为终端输入安全插入的名称，包括 UTF-8 有损解码产生的替换字符。
fn suggestible_name(name: &str) -> bool {
    !name.is_empty()
        && !matches!(name, "." | "..")
        && !name.contains('/')
        && !name.contains('\u{fffd}')
        && !name.chars().any(char::is_control)
}

/// 为常见命令提供简短中文说明，其余命令沿用通用描述。
fn command_description(command: &str) -> &'static str {
    match command {
        "cd" => "切换当前目录",
        "ls" => "列出目录内容",
        "pwd" => "显示当前目录",
        "cat" => "输出文件内容",
        "less" => "分页查看文本",
        "head" => "查看文件开头",
        "tail" => "查看文件末尾或跟踪日志",
        "grep" => "按模式搜索文本",
        "find" => "搜索文件和目录",
        "sed" => "流式文本替换与处理",
        "awk" => "按字段处理文本",
        "cp" => "复制文件或目录",
        "mv" => "移动或重命名文件",
        "rm" => "删除文件或目录",
        "mkdir" => "创建目录",
        "touch" => "创建文件或更新时间",
        "chmod" => "修改文件权限",
        "chown" => "修改文件所有者",
        "ps" => "查看进程",
        "top" | "htop" => "查看系统进程和资源",
        "kill" | "pkill" => "终止进程",
        "systemctl" => "管理 systemd 服务",
        "journalctl" => "查看 systemd 日志",
        "ssh" => "连接另一台 SSH 主机",
        "scp" => "通过 SSH 复制文件",
        "curl" => "发送网络请求",
        "wget" => "下载网络资源",
        "git" => "版本控制工具",
        "docker" => "管理 Docker 容器与镜像",
        "kubectl" => "管理 Kubernetes 集群",
        "node" => "运行 Node.js 程序",
        "npm" => "Node.js 包管理器",
        "pnpm" => "高效的 Node.js 包管理器",
        "python" | "python3" => "运行 Python 程序",
        "cargo" => "Rust 构建与包管理工具",
        "vim" | "vi" => "终端文本编辑器",
        "nano" => "简易终端文本编辑器",
        "clear" => "清空终端屏幕",
        "exit" => "退出当前 shell",
        _ => "远端可执行命令",
    }
}

impl ShellSuggestion {
    /// 返回稳定的类型标识，用于不同来源候选去重且保持 IPC 枚举兼容。
    fn kind_label(&self) -> &'static str {
        match self.kind {
            SuggestionKind::Command => "command",
            SuggestionKind::Directory => "directory",
            SuggestionKind::File => "file",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// 断言当前单词的解码内容和命令位置，供解析回归测试复用。
    fn assert_token(line: &str, value: &str, command_position: bool) {
        let token = current_token(line).unwrap();
        assert_eq!(token.value, value, "{line:?}");
        assert_eq!(token.command_position, command_position, "{line:?}");
    }

    /// 验证单双引号、混合引用、转义空格及未闭合单词。
    #[test]
    fn extracts_shell_aware_tokens() {
        assert_token("dock", "dock", true);
        assert_token("cd /var/lo", "/var/lo", false);
        assert_token("cd '/tmp/my fo", "/tmp/my fo", false);
        assert_token("cat \"my file\"", "my file", false);
        assert_token(r"cat my\ file", "my file", false);
        assert_token(r"cat 'it'\''s fi", "it's fi", false);
        assert_token(r"cat foo\", "foo", false);
        assert_token(r#"cat "a\q""#, r"a\q", false);
        assert_token(r#"cat "a\"b""#, "a\"b", false);
        assert_token(r"cat 'a\b'", r"a\b", false);
        assert_token("cat 文件\\ 名", "文件 名", false);
    }

    /// 验证尾空格允许参数补全，而空行和新命令位置保持空命令语义。
    #[test]
    fn recognizes_empty_arguments_and_operators() {
        assert_token("", "", true);
        assert_token("  ", "", true);
        assert_token("ls ", "", false);
        assert_token("ls   ", "", false);
        assert_token("ls | ", "", true);
        assert_token("ls&&dock", "dock", true);
        assert_token("echo ok;git", "git", true);
        assert_token("cat>/tm", "/tm", false);
        assert_token("echo ok\ngit", "git", true);
    }

    /// 验证只让原始未引用的 HOME 前缀展开，引用或转义的波浪号保留字面语义。
    #[test]
    fn distinguishes_home_from_literal_tilde() {
        assert!(current_token("cd ~/fi").unwrap().home);
        assert!(current_token("cd ~").unwrap().home);
        assert!(current_token("cd ~/'my fi").unwrap().home);
        assert!(!current_token("cd '~/fi'").unwrap().home);
        assert!(!current_token(r#"cd "~/fi""#).unwrap().home);
        assert!(!current_token(r"cd \~/fi").unwrap().home);
        assert!(current_token("cd ~another/fi").is_none());
    }

    /// 验证不执行展开或复合语法，同时仍允许安全引用的特殊字符字面文件名。
    #[test]
    fn rejects_expansions_but_accepts_quoted_literals() {
        for line in [
            "cat $HOME/f",
            "cat $(id)",
            "cat `id`",
            "cat *.txt",
            "cat a?",
            "cat [a]",
            "cat {a,b}",
            "echo # comment",
            "ENV=value cmd",
            "cat \u{1b}[31m",
        ] {
            assert!(current_token(line).is_none(), "{line:?}");
        }
        assert_token("cat '$(id)'", "$(id)", false);
        assert_token(r"cat \$name", "$name", false);
        assert_token(r#"cat "\$name""#, "$name", false);
        assert_token("cat 'a*; b'", "a*; b", false);
    }

    /// 验证路径拆分保留斜杠且 Unicode 前缀不会破坏 UTF-8 边界。
    #[test]
    fn splits_path_prefix() {
        assert_eq!(split_path_token("/var/lo"), ("/var/", "lo"));
        assert_eq!(split_path_token("src"), ("", "src"));
        assert_eq!(split_path_token("/文件/名"), ("/文件/", "名"));
    }

    /// 验证父目录缓存键包含 cwd 和 HOME 语义，字面波浪号不会被误展开。
    #[test]
    fn resolves_directory_targets() {
        assert_eq!(directory_target("", "/root", false).path, "/root");
        assert_eq!(directory_target("src/", "/root", false).path, "/root/src");
        assert_eq!(directory_target("/var/", "/root", false).path, "/var");
        assert_eq!(directory_target("", "/", false).path, "/");
        assert_eq!(directory_target("~/", "/root", false).path, "/root/~");
        assert_eq!(directory_target("~/", "/root", true).path, "~");
        assert!(directory_target("src/", "", false).home);
        assert_eq!(directory_target("src/", "", false).path, "~/src");
        assert_eq!(directory_target("", "-name", false).path, "./-name");
        assert_ne!(
            directory_target("", "/one", false),
            directory_target("", "/two", false)
        );
    }

    /// 验证候选整体替换能够消除命令替换、引号、分号和空格的 shell 特殊含义。
    #[test]
    fn produces_safe_complete_shell_words() {
        assert_eq!(shell_value("/var/log/", false), "/var/log/");
        assert_eq!(shell_value("/tmp/my file/", false), "'/tmp/my file/'");
        assert_eq!(shell_value("it's", false), r"'it'\''s'");
        assert_eq!(shell_value("$(id); file", false), "'$(id); file'");
        assert_eq!(shell_value("name=value", false), "'name=value'");
        assert_eq!(shell_value("~/my file/", true), "~/'my file/'");
        assert_eq!(shell_value("~/src/", true), "~/src/");
        assert_eq!(shell_value("~/src/", false), "'~/src/'");
        assert_eq!(shell_value("", false), "''");
        for name in ["my file", "it's", "a\\b", "a;b", "$literal", "文件 名"] {
            assert_eq!(
                current_token(&format!("cat {}", shell_value(name, false)))
                    .unwrap()
                    .value,
                name
            );
        }
    }

    /// 验证 NUL 名称解析保留首尾空格和箭头文本，过滤终端控制字符及有损名称。
    #[test]
    fn parses_nul_directory_names_without_ls_ambiguity() {
        let catalog = parse_directory_catalog("startup noise\0d\0 my dir \0f\0it's -> file\0f\0bad\nname\0f\0bad\u{1b}name\0f\0bad\u{fffd}\0");
        assert_eq!(
            catalog.entries,
            vec![
                PathEntry {
                    name: " my dir ".into(),
                    directory: true
                },
                PathEntry {
                    name: "it's -> file".into(),
                    directory: false
                },
            ]
        );
        assert!(!catalog.truncated);
    }

    /// 验证空参数、目录排序、隐藏项、真实大小写和安全候选值。
    #[test]
    fn builds_sorted_safe_path_candidates() {
        let entries = vec![
            PathEntry {
                name: "notes.txt".into(),
                directory: false,
            },
            PathEntry {
                name: "my dir".into(),
                directory: true,
            },
            PathEntry {
                name: ".hidden".into(),
                directory: true,
            },
            PathEntry {
                name: "My upper".into(),
                directory: false,
            },
        ];
        let matches = path_candidates(&entries, "", "", false);
        assert_eq!(matches[0].value, "'my dir/'");
        assert_eq!(matches.len(), 3);
        assert!(path_candidates(&entries, "", "M", false)
            .iter()
            .any(|item| item.label == "My upper"));
        let case_corrected = vec![PathEntry {
            name: "Mirai".into(),
            directory: true,
        }];
        assert_eq!(
            path_candidates(&case_corrected, "", "mi", false)[0].value,
            "Mirai/"
        );
        assert_eq!(
            path_candidates(&entries, "~/", "my", true)[0].value,
            "~/'my dir/'"
        );
        assert_eq!(
            path_candidates(&entries, "", ".", false)[0].label,
            ".hidden"
        );
    }

    /// 验证远端探测仅展开固定 HOME，目录和用户匹配前缀始终通过安全引用构造。
    #[test]
    fn quotes_probe_inputs_and_avoids_login_shells() {
        let target = DirectoryTarget {
            path: "~/my dir/it's;$(id)".into(),
            home: true,
        };
        let probe = directory_probe(&target, "x';$(id)*");
        let inner = current_token(probe.strip_prefix("env BASH_ENV= ENV= sh -c ").unwrap())
            .unwrap()
            .value;
        assert!(inner.contains(&format!("\"$HOME\"/{}", quote("my dir/it's;$(id)"))));
        assert!(inner.contains(&format!("in {}*)", ascii_case_prefix("x';$(id)*"))));
        assert_eq!(ascii_case_prefix("mi"), "[mM][iI]");
        assert_eq!(ascii_case_prefix("*[]$;"), quote("*[]$;"));
        assert!(inner.contains("printf '%s\\000%s\\000'"));
        let command = command_probe("x';$(id)");
        assert!(!command.contains("bash -lc"));
        let inner = current_token(
            command
                .strip_prefix("env BASH_ENV= ENV= bash --noprofile --norc -c ")
                .unwrap(),
        )
        .unwrap()
        .value;
        assert!(inner.contains(&format!("compgen -c -- {}", quote("x';$(id)"))));
    }

    /// 验证库存截断标志与名称去重，允许按前缀回退找到尾部命令或目录。
    #[test]
    fn detects_catalog_truncation() {
        let commands = (0..=MAX_COMMAND_NAMES)
            .map(|index| format!("cmd{index:05}\n"))
            .collect::<String>();
        let catalog = parse_command_catalog(&commands);
        assert!(catalog.truncated);
        assert_eq!(catalog.names.len(), MAX_COMMAND_NAMES);
        assert_eq!(
            parse_command_catalog(" git\ngit\ngit\n").names,
            vec![" git", "git"]
        );
        let mut paths = "\0".to_owned();
        for index in 0..=MAX_DIRECTORY_NAMES {
            paths.push_str(&format!("f\0file{index}\0"));
        }
        let catalog = parse_directory_catalog(&paths);
        assert!(catalog.truncated);
        assert_eq!(catalog.entries.len(), MAX_DIRECTORY_NAMES);
    }

    /// 验证并发和后续请求复用同一个探测结果，而不是每按一个键都开远端通道。
    #[tokio::test]
    async fn coalesces_concurrent_probes_and_reuses_cache() {
        let probe = CachedProbe::<String>::default();
        let calls = AtomicUsize::new(0);
        let fetch = |_| async {
            calls.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            Some("cached".to_owned())
        };
        let deadline = Instant::now() + SOURCE_BUDGET;
        let (first, second) = tokio::join!(
            probe.get_or_fetch(COMMAND_TTL, deadline, fetch),
            probe.get_or_fetch(COMMAND_TTL, deadline, fetch),
        );
        assert!(Arc::ptr_eq(&first.unwrap(), &second.unwrap()));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        probe
            .get_or_fetch(COMMAND_TTL, deadline, fetch)
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        probe.state.lock().await.as_mut().unwrap().expires_at = Instant::now();
        probe
            .get_or_fetch(COMMAND_TTL, deadline, fetch)
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    /// 验证失败短缓存，缓存过期后允许恢复而不是永久禁用高延迟连接的补全。
    #[tokio::test]
    async fn caches_failures_only_briefly() {
        let probe = CachedProbe::<String>::default();
        let calls = AtomicUsize::new(0);
        let deadline = Instant::now() + SOURCE_BUDGET;
        for _ in 0..2 {
            assert!(probe
                .get_or_fetch(COMMAND_TTL, deadline, |_| async {
                    calls.fetch_add(1, Ordering::SeqCst);
                    None
                })
                .await
                .is_none());
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let mut state = probe.state.lock().await;
        assert!(state.as_ref().unwrap().expires_at <= Instant::now() + FAILURE_TTL);
        state.as_mut().unwrap().expires_at = Instant::now();
        drop(state);
        assert!(probe
            .get_or_fetch(COMMAND_TTL, deadline, |_| async {
                Some("recovered".into())
            })
            .await
            .is_some());
    }

    /// 验证截止时间同时覆盖探测和等待同键锁，超时不会留下永久占锁的请求。
    #[tokio::test]
    async fn bounds_probe_and_lock_wait_times() {
        let probe = CachedProbe::<String>::default();
        assert!(probe
            .get_or_fetch(
                COMMAND_TTL,
                Instant::now() + Duration::from_millis(10),
                |_| std::future::pending::<Option<String>>()
            )
            .await
            .is_none());
        let held = probe.state.lock().await;
        assert!(probe
            .get_or_fetch(
                COMMAND_TTL,
                Instant::now() + Duration::from_millis(10),
                |_| async { panic!("等待锁超时后不应启动探测") }
            )
            .await
            .is_none());
        drop(held);
        assert!(probe.state.try_lock().is_ok());
    }

    /// 验证缓存按会话和父目录隔离，相同父目录的连续前缀复用同键资源。
    #[tokio::test]
    async fn isolates_sessions_and_directory_keys() {
        let first = CompletionCache::default();
        let second = CompletionCache::default();
        let key = DirectoryKey {
            target: directory_target("", "/one", false),
            prefix: String::new(),
        };
        let one = cached_slot(&first.directories, key.clone()).await.unwrap();
        let again = cached_slot(&first.directories, key.clone()).await.unwrap();
        let other_session = cached_slot(&second.directories, key).await.unwrap();
        let other_cwd = cached_slot(
            &first.directories,
            DirectoryKey {
                target: directory_target("", "/two", false),
                prefix: String::new(),
            },
        )
        .await
        .unwrap();
        assert!(Arc::ptr_eq(&one, &again));
        assert!(!Arc::ptr_eq(&one, &other_session));
        assert!(!Arc::ptr_eq(&one, &other_cwd));
    }

    /// 验证会话只提供两个补全探测额度，排队可以限时结束且额度会释放。
    #[tokio::test]
    async fn limits_each_sessions_probe_channels() {
        let cache = CompletionCache::default();
        let first = cache.slots.acquire().await.unwrap();
        let second = cache.slots.acquire().await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(10), cache.slots.acquire())
                .await
                .is_err()
        );
        drop(first);
        assert!(cache.slots.try_acquire().is_ok());
        drop(second);
        assert_eq!(cache.slots.available_permits(), 2);
    }

    /// 验证有界 LRU 不淘汰正在使用的探测，额度耗尽时不创建重复的临时请求。
    #[tokio::test]
    async fn bounds_cached_keys_without_evicting_active_probes() {
        let slots = Mutex::new(HashMap::<usize, ProbeSlot<String>>::new());
        let mut held = Vec::new();
        for key in 0..MAX_CACHED_KEYS {
            held.push(cached_slot(&slots, key).await.unwrap());
        }
        assert!(cached_slot(&slots, MAX_CACHED_KEYS).await.is_none());
        assert!(Arc::ptr_eq(
            &held[0],
            &cached_slot(&slots, 0).await.unwrap()
        ));
        held.pop();
        assert!(cached_slot(&slots, MAX_CACHED_KEYS).await.is_some());
        assert_eq!(slots.lock().await.len(), MAX_CACHED_KEYS);
    }
}
