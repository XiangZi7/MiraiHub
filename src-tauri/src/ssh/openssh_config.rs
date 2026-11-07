//! 解析 OpenSSH 客户端配置（`~/.ssh/config`），产出可导入的连接预览。
//!
//! 只读不写：这里不创建任何连接，只把能映射到 MiraiHub 连接模型的部分
//! （HostName / User / Port / IdentityFile / ProxyJump）整理成预览，
//! 真正落库由前端在用户勾选确认后完成。映射不了的设置一律变成警告，
//! 不做静默丢弃，免得用户以为导入后的行为和命令行 `ssh` 一致。
//!
//! 取值规则与 OpenSSH 相同：按文件顺序遍历所有匹配的块，**首个出现的值生效**。
//! 因此 `Host *` 这类通配块虽然不作为导入项，其中的设置仍会作为默认值合并进来。

use std::{
    collections::HashSet,
    fs, io,
    path::{Path, PathBuf},
};

use serde::Serialize;
use tauri::WebviewWindow;

use crate::error::{AppError, AppResult};

use super::keys;

/// 只有主工作区窗口能读本机 SSH 配置；子窗口（编辑器、连接表单等）没有这个需要。
fn main_window(window: &WebviewWindow) -> AppResult<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(AppError::invalid_input("仅主工作区可以执行此操作"))
    }
}

/// Include 的最大嵌套深度，与 OpenSSH 的 READCONF_MAX_DEPTH 一致
const MAX_DEPTH: usize = 16;
/// 单个配置文件的大小上限。正常的 config 不过几十 KB
const MAX_FILE_BYTES: u64 = 1024 * 1024;
/// 预览最多列出的主机数
const MAX_HOSTS: usize = 2_000;
/// 展开后的跳板链长度上限，防御病态配置
const MAX_JUMP_HOPS: usize = 16;

/// 一条警告。`kind` 是稳定的机器可读标识，前端据此翻译；`detail` 是附带的原文信息。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSshWarning {
    pub kind: String,
    pub detail: String,
}

fn warning(kind: &str, detail: impl Into<String>) -> OpenSshWarning {
    OpenSshWarning {
        kind: kind.to_string(),
        detail: detail.into(),
    }
}

/// 跳板链中的一跳。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSshJumpHop {
    /// 引用的是同文件里的 Host 别名时为该别名
    pub alias: Option<String>,
    pub host: String,
    pub port: u16,
    pub user: String,
}

/// 一个可导入的主机。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSshHost {
    pub alias: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    /// 已展开 `~` 与 `%` token 的私钥路径
    pub identity_file: Option<String>,
    /// 完整跳板链（含跳板机自身的 ProxyJump），按连接顺序排列
    pub jump: Vec<OpenSshJumpHop>,
    pub warnings: Vec<OpenSshWarning>,
}

/// 预览结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSshImportPreview {
    /// 读取的配置文件路径
    pub path: String,
    /// 配置文件是否存在
    pub found: bool,
    pub hosts: Vec<OpenSshHost>,
    /// 文件级警告：Match 块、Include 失败等
    pub warnings: Vec<OpenSshWarning>,
}

/// 配置文件来源。抽成 trait 是为了单元测试能用内存文件覆盖 Include。
pub trait ConfigSource {
    fn read_to_string(&self, path: &Path) -> io::Result<String>;
    /// 列出目录下的文件名（不含路径）
    fn list_dir(&self, dir: &Path) -> io::Result<Vec<String>>;
}

/// 真实文件系统。
struct FsSource;

impl ConfigSource for FsSource {
    fn read_to_string(&self, path: &Path) -> io::Result<String> {
        let meta = fs::metadata(path)?;
        if !meta.is_file() {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "不是普通文件"));
        }
        if meta.len() > MAX_FILE_BYTES {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "文件过大"));
        }
        fs::read_to_string(path)
    }

    fn list_dir(&self, dir: &Path) -> io::Result<Vec<String>> {
        let mut names = Vec::new();
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                names.push(entry.file_name().to_string_lossy().into_owned());
            }
        }
        Ok(names)
    }
}

/// 解析时用到的本机环境。
pub struct ParseContext {
    /// `~/.ssh`，Include 相对路径的基准
    pub ssh_dir: PathBuf,
    /// 用户主目录，用于 `~` 与 `%d`
    pub home: String,
    /// 本机用户名：`%u`，以及未配置 User 时的默认值（与 ssh 行为一致）
    pub local_user: String,
    /// 是否把 `/` 统一成 `\`（Windows 下私钥路径更直观）
    pub windows_paths: bool,
}

/// 一个配置块：Host / Match 行之后、下一个块之前的选项。
struct Block {
    /// 生效条件：每一项是一行 Host 的模式表，全部满足才生效。
    /// 多于一项来自 Host 块内的 Include —— 被包含文件里的块还要叠加外层条件。
    conditions: Vec<Vec<String>>,
    /// Match 块（及其内部 Include 的内容）无法求值，整体跳过
    skip: bool,
    /// 本块自己那行 Host 的模式，用于枚举可导入的别名
    own_patterns: Vec<String>,
    options: Vec<(String, Vec<String>)>,
}

impl Block {
    fn new(conditions: Vec<Vec<String>>, skip: bool) -> Self {
        Self {
            conditions,
            skip,
            own_patterns: Vec::new(),
            options: Vec::new(),
        }
    }

    fn applies_to(&self, host: &str) -> bool {
        !self.skip
            && self
                .conditions
                .iter()
                .all(|patterns| host_patterns_match(patterns, host))
    }
}

/// 某个主机名按首匹配规则合并后的设置。
#[derive(Default)]
struct Resolved {
    hostname: Option<String>,
    user: Option<String>,
    port: Option<String>,
    identity_files: Vec<String>,
    proxy: Option<Proxy>,
    forwards: bool,
}

/// ProxyJump 与 ProxyCommand 互斥，OpenSSH 里先出现的那个生效。
enum Proxy {
    Jump(String),
    Command(String),
}

struct Parser<'a> {
    source: &'a dyn ConfigSource,
    ctx: &'a ParseContext,
    blocks: Vec<Block>,
    warnings: Vec<OpenSshWarning>,
    /// 当前 Include 链上的文件，防止循环包含
    stack: Vec<PathBuf>,
}

impl<'a> Parser<'a> {
    fn parse_text(
        &mut self,
        text: &str,
        file: &str,
        conditions: Vec<Vec<String>>,
        skip: bool,
        depth: usize,
    ) {
        self.blocks.push(Block::new(conditions.clone(), skip));

        for (index, line) in text.lines().enumerate() {
            let location = format!("{file}:{}", index + 1);
            let (keyword, args) = match split_line(line) {
                Ok(Some(parsed)) => parsed,
                Ok(None) => continue,
                Err(reason) => {
                    self.warnings
                        .push(warning("syntax", format!("{location} {reason}")));
                    continue;
                }
            };

            match keyword.as_str() {
                "host" => {
                    let mut next = conditions.clone();
                    next.push(args.clone());
                    let mut block = Block::new(next, skip);
                    block.own_patterns = args;
                    self.blocks.push(block);
                }
                "match" => {
                    self.warnings
                        .push(warning("matchSkipped", format!("{location} Match {}", args.join(" "))));
                    self.blocks.push(Block::new(conditions.clone(), true));
                }
                "include" => {
                    let (scope, scope_skip) = {
                        let current = self.blocks.last().expect("至少有一个块");
                        (current.conditions.clone(), current.skip)
                    };
                    for pattern in &args {
                        self.include(pattern, &location, scope.clone(), scope_skip, depth);
                    }
                    // 被包含文件追加了自己的块，之后的选项回到外层块的作用域
                    self.blocks.push(Block::new(scope, scope_skip));
                }
                _ => {
                    if let Some(block) = self.blocks.last_mut() {
                        block.options.push((keyword, args));
                    }
                }
            }
        }
    }

    fn include(
        &mut self,
        pattern: &str,
        location: &str,
        conditions: Vec<Vec<String>>,
        skip: bool,
        depth: usize,
    ) {
        if depth + 1 > MAX_DEPTH {
            self.warnings
                .push(warning("includeDepth", format!("{location} {pattern}")));
            return;
        }

        for path in self.resolve_include(pattern, location) {
            if self.stack.contains(&path) {
                self.warnings.push(warning(
                    "includeCycle",
                    format!("{location} {}", path.display()),
                ));
                continue;
            }
            let text = match self.source.read_to_string(&path) {
                Ok(text) => text,
                // 与 ssh 一致：不存在的 Include 静默忽略
                Err(err) if err.kind() == io::ErrorKind::NotFound => continue,
                Err(err) => {
                    self.warnings.push(warning(
                        "includeFailed",
                        format!("{} ({err})", path.display()),
                    ));
                    continue;
                }
            };
            self.stack.push(path.clone());
            let name = path.display().to_string();
            self.parse_text(&text, &name, conditions.clone(), skip, depth + 1);
            self.stack.pop();
        }
    }

    /// 把 Include 参数展开成文件列表。相对路径以 `~/.ssh` 为基准，
    /// 文件名部分支持 `*` / `?` 通配，结果按名称排序（与 glob(3) 一致）。
    fn resolve_include(&mut self, pattern: &str, location: &str) -> Vec<PathBuf> {
        let expanded = expand_tilde(pattern, &self.ctx.home);
        let raw = Path::new(&expanded);
        let full = if raw.is_absolute() || expanded.starts_with('/') {
            raw.to_path_buf()
        } else {
            self.ctx.ssh_dir.join(raw)
        };

        let file_name = full
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let parent = full.parent().map(Path::to_path_buf).unwrap_or_default();

        if parent.to_string_lossy().contains(['*', '?']) {
            self.warnings
                .push(warning("includeUnsupported", format!("{location} {pattern}")));
            return Vec::new();
        }
        if !file_name.contains(['*', '?']) {
            return vec![full];
        }

        let mut names = match self.source.list_dir(&parent) {
            Ok(names) => names,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Vec::new(),
            Err(err) => {
                self.warnings
                    .push(warning("includeFailed", format!("{} ({err})", parent.display())));
                return Vec::new();
            }
        };
        names.retain(|name| wildcard_match(&file_name, name, false));
        names.sort();
        names.into_iter().map(|name| parent.join(name)).collect()
    }

    /// 按首匹配规则合并某个主机名的设置。
    fn resolve(&self, host: &str) -> Resolved {
        let mut out = Resolved::default();
        for block in self.blocks.iter().filter(|block| block.applies_to(host)) {
            for (keyword, args) in &block.options {
                let first = args.first().cloned();
                match keyword.as_str() {
                    "hostname" if out.hostname.is_none() => out.hostname = first,
                    "user" if out.user.is_none() => out.user = first,
                    "port" if out.port.is_none() => out.port = first,
                    "identityfile" => out.identity_files.extend(first),
                    "proxyjump" if out.proxy.is_none() => {
                        out.proxy = first.map(Proxy::Jump);
                    }
                    "proxycommand" if out.proxy.is_none() && !args.is_empty() => {
                        out.proxy = Some(Proxy::Command(args.join(" ")));
                    }
                    "localforward" | "remoteforward" | "dynamicforward" => out.forwards = true,
                    _ => {}
                }
            }
        }
        out
    }

    /// 文件中出现过的具体别名（不含通配、不含否定），按出现顺序去重。
    fn aliases(&self) -> Vec<String> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for block in self.blocks.iter().filter(|block| !block.skip) {
            for pattern in &block.own_patterns {
                if is_concrete(pattern) && seen.insert(pattern.to_ascii_lowercase()) {
                    out.push(pattern.clone());
                }
            }
        }
        out
    }

    fn build_host(&self, alias: &str, aliases: &[String]) -> OpenSshHost {
        let resolved = self.resolve(alias);
        let mut warnings = Vec::new();

        let host = resolved
            .hostname
            .as_deref()
            .map(|value| expand_hostname(value, alias))
            .unwrap_or_else(|| alias.to_string());
        let port = parse_port(resolved.port.as_deref(), &mut warnings);
        let user = match resolved.user.clone() {
            Some(user) => user,
            None => {
                warnings.push(warning("userDefaulted", self.ctx.local_user.clone()));
                self.ctx.local_user.clone()
            }
        };

        let identity_file = resolved
            .identity_files
            .first()
            .map(|raw| self.expand_identity(raw, &host, &user, &mut warnings));
        if resolved.identity_files.len() > 1 {
            warnings.push(warning(
                "multipleIdentityFiles",
                resolved.identity_files.join(", "),
            ));
        }
        if resolved.forwards {
            warnings.push(warning("forwardIgnored", ""));
        }

        let mut visiting = vec![alias.to_ascii_lowercase()];
        let jump = match self.jump_chain(&resolved, aliases, &mut visiting) {
            Ok(chain) => chain,
            Err(problem) => {
                warnings.push(problem);
                Vec::new()
            }
        };

        OpenSshHost {
            alias: alias.to_string(),
            host,
            port,
            user,
            identity_file,
            jump,
            warnings,
        }
    }

    /// 把 ProxyJump 展开成完整跳板链。跳板机自己若也配置了 ProxyJump，
    /// 其链条排在前面 —— MiraiHub 的 jumpHostIds 是一条扁平的完整链。
    fn jump_chain(
        &self,
        resolved: &Resolved,
        aliases: &[String],
        visiting: &mut Vec<String>,
    ) -> Result<Vec<OpenSshJumpHop>, OpenSshWarning> {
        let spec = match &resolved.proxy {
            None => return Ok(Vec::new()),
            Some(Proxy::Command(command)) => {
                if command.eq_ignore_ascii_case("none") {
                    return Ok(Vec::new());
                }
                return Err(warning("proxyCommand", command.clone()));
            }
            Some(Proxy::Jump(spec)) => spec,
        };
        if spec.eq_ignore_ascii_case("none") {
            return Ok(Vec::new());
        }

        let mut chain = Vec::new();
        for raw in spec.split(',').map(str::trim).filter(|hop| !hop.is_empty()) {
            let (explicit_user, name, explicit_port) =
                parse_jump_hop(raw).ok_or_else(|| warning("jumpInvalid", raw))?;

            let key = name.to_ascii_lowercase();
            if visiting.contains(&key) {
                return Err(warning("jumpCycle", raw));
            }
            let alias = aliases
                .iter()
                .find(|alias| alias.eq_ignore_ascii_case(&name))
                .cloned();

            // 跳板机名同样走一遍配置：别名会解析出 HostName，通配块提供默认 User / Port
            let hop_settings = self.resolve(&name);
            visiting.push(key);
            let nested = self.jump_chain(&hop_settings, aliases, visiting);
            visiting.pop();
            chain.extend(nested?);

            let mut ignored = Vec::new();
            chain.push(OpenSshJumpHop {
                host: hop_settings
                    .hostname
                    .as_deref()
                    .map(|value| expand_hostname(value, &name))
                    .unwrap_or_else(|| name.clone()),
                port: match explicit_port {
                    Some(port) => port,
                    None => parse_port(hop_settings.port.as_deref(), &mut ignored),
                },
                user: explicit_user
                    .or(hop_settings.user)
                    .unwrap_or_else(|| self.ctx.local_user.clone()),
                alias,
            });
            if chain.len() > MAX_JUMP_HOPS {
                return Err(warning("jumpTooLong", spec.clone()));
            }
        }
        Ok(chain)
    }

    /// 展开 IdentityFile：`~`、`%d` `%u` `%h` `%r` `%%`。
    fn expand_identity(
        &self,
        raw: &str,
        host: &str,
        user: &str,
        warnings: &mut Vec<OpenSshWarning>,
    ) -> String {
        if raw.starts_with('~') && !raw.starts_with("~/") && !raw.starts_with("~\\") && raw != "~"
        {
            warnings.push(warning("unsupportedToken", raw));
        }
        let tilde = expand_tilde(raw, &self.ctx.home);

        let mut out = String::with_capacity(tilde.len());
        let mut chars = tilde.chars();
        while let Some(ch) = chars.next() {
            if ch != '%' {
                out.push(ch);
                continue;
            }
            match chars.next() {
                Some('%') => out.push('%'),
                Some('d') => out.push_str(&self.ctx.home),
                Some('u') => out.push_str(&self.ctx.local_user),
                Some('h') => out.push_str(host),
                Some('r') => out.push_str(user),
                Some(other) => {
                    warnings.push(warning("unsupportedToken", format!("%{other}")));
                    out.push('%');
                    out.push(other);
                }
                None => out.push('%'),
            }
        }

        if self.ctx.windows_paths {
            out = out.replace('/', "\\");
        }
        if !is_absolute_path(&out) {
            warnings.push(warning("relativeIdentityFile", out.clone()));
        }
        out
    }
}

/// 解析配置文本（含 Include），产出预览中的主机与文件级警告。
pub fn parse_config(
    text: &str,
    file: &str,
    source: &dyn ConfigSource,
    ctx: &ParseContext,
    top_path: Option<PathBuf>,
) -> (Vec<OpenSshHost>, Vec<OpenSshWarning>) {
    let mut parser = Parser {
        source,
        ctx,
        blocks: Vec::new(),
        warnings: Vec::new(),
        stack: top_path.into_iter().collect(),
    };
    parser.parse_text(text, file, Vec::new(), false, 0);

    let aliases = parser.aliases();
    if aliases.len() > MAX_HOSTS {
        parser
            .warnings
            .push(warning("tooManyHosts", MAX_HOSTS.to_string()));
    }
    let hosts = aliases
        .iter()
        .take(MAX_HOSTS)
        .map(|alias| parser.build_host(alias, &aliases))
        .collect();
    (hosts, parser.warnings)
}

/// 拆一行配置：关键字（转小写）与参数表。空行与注释返回 None。
///
/// 支持 `Key Value` 与 `Key=Value` 两种写法，参数可用单 / 双引号包裹，
/// 未加引号的 `#` 开头的词视为行尾注释。
fn split_line(line: &str) -> Result<Option<(String, Vec<String>)>, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return Ok(None);
    }

    let end = trimmed
        .find(|ch: char| ch.is_whitespace() || ch == '=')
        .unwrap_or(trimmed.len());
    let keyword = trimmed[..end].to_ascii_lowercase();
    let mut rest = trimmed[end..].trim_start();
    if let Some(stripped) = rest.strip_prefix('=') {
        rest = stripped.trim_start();
    }

    let args = split_args(rest)?;
    if args.is_empty() {
        return Err(format!("{keyword} 缺少参数"));
    }
    Ok(Some((keyword, args)))
}

/// 按空白切分参数，处理引号与有限的反斜杠转义。
///
/// 反斜杠只在后面跟引号、空格或反斜杠时才算转义，
/// 否则原样保留 —— Windows 路径 `C:\Users\me` 不能被吃掉反斜杠。
fn split_args(input: &str) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let mut chars = input.chars().peekable();

    loop {
        while chars.peek().is_some_and(|ch| ch.is_whitespace()) {
            chars.next();
        }
        match chars.peek() {
            None => break,
            Some('#') => break,
            _ => {}
        }

        let mut token = String::new();
        let mut quote: Option<char> = None;
        while let Some(&ch) = chars.peek() {
            if quote.is_none() && ch.is_whitespace() {
                break;
            }
            chars.next();
            match ch {
                '"' | '\'' if quote.is_none() => quote = Some(ch),
                _ if Some(ch) == quote => quote = None,
                '\\' => match chars.peek() {
                    Some(&next) if matches!(next, '"' | '\'' | '\\' | ' ') => {
                        token.push(next);
                        chars.next();
                    }
                    _ => token.push('\\'),
                },
                _ => token.push(ch),
            }
        }
        if quote.is_some() {
            return Err("引号未闭合".to_string());
        }
        args.push(token);
    }
    Ok(args)
}

/// 一行 Host 的模式表是否匹配：任一否定模式命中即不匹配，否则需要任一肯定模式命中。
fn host_patterns_match(patterns: &[String], host: &str) -> bool {
    let mut matched = false;
    for pattern in patterns {
        if let Some(negated) = pattern.strip_prefix('!') {
            if wildcard_match(negated, host, true) {
                return false;
            }
        } else if wildcard_match(pattern, host, true) {
            matched = true;
        }
    }
    matched
}

/// `*` / `?` 通配匹配。主机名匹配大小写不敏感，文件名匹配区分大小写。
fn wildcard_match(pattern: &str, text: &str, ignore_case: bool) -> bool {
    let normalize = |value: &str| -> Vec<char> {
        if ignore_case {
            value.to_lowercase().chars().collect()
        } else {
            value.chars().collect()
        }
    };
    let pattern = normalize(pattern);
    let text = normalize(text);

    // 经典的贪心回溯：记住最近一个 `*` 的位置，失配时回到那里多吞一个字符
    let (mut p, mut t) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while t < text.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == text[t]) {
            p += 1;
            t += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some((p, t));
            p += 1;
        } else if let Some((star_p, star_t)) = star {
            p = star_p + 1;
            t = star_t + 1;
            star = Some((star_p, star_t + 1));
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|&ch| ch == '*')
}

/// 能作为导入项的具体别名：不含通配，不是否定模式。
fn is_concrete(pattern: &str) -> bool {
    !pattern.is_empty() && !pattern.contains(['*', '?', '!'])
}

fn expand_tilde(raw: &str, home: &str) -> String {
    if raw == "~" {
        home.to_string()
    } else if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        format!("{}/{rest}", home.trim_end_matches(['/', '\\']))
    } else {
        raw.to_string()
    }
}

/// HostName 只支持 `%h`（原始别名）与 `%%`。
fn expand_hostname(value: &str, alias: &str) -> String {
    value.replace("%%", "\u{0}").replace("%h", alias).replace('\u{0}', "%")
}

fn parse_port(raw: Option<&str>, warnings: &mut Vec<OpenSshWarning>) -> u16 {
    match raw {
        None => 22,
        Some(value) => match value.parse::<u16>() {
            Ok(port) if port > 0 => port,
            _ => {
                warnings.push(warning("invalidPort", value));
                22
            }
        },
    }
}

/// 解析一跳 `[ssh://][user@]host[:port]`，IPv6 地址用方括号包裹。
fn parse_jump_hop(raw: &str) -> Option<(Option<String>, String, Option<u16>)> {
    let raw = raw.strip_prefix("ssh://").unwrap_or(raw);
    let (user, rest) = match raw.rfind('@') {
        Some(index) => (Some(raw[..index].to_string()), &raw[index + 1..]),
        None => (None, raw),
    };
    if user.as_deref() == Some("") {
        return None;
    }

    let (host, port) = if let Some(bracketed) = rest.strip_prefix('[') {
        let close = bracketed.find(']')?;
        let host = &bracketed[..close];
        let tail = &bracketed[close + 1..];
        let port = match tail.strip_prefix(':') {
            Some(port) => Some(port),
            None if tail.is_empty() => None,
            None => return None,
        };
        (host.to_string(), port)
    } else {
        match rest.split_once(':') {
            Some((host, port)) if !port.contains(':') => (host.to_string(), Some(port)),
            Some(_) => return None,
            None => (rest.to_string(), None),
        }
    };

    if host.is_empty() || host.contains(char::is_whitespace) {
        return None;
    }
    let port = match port {
        Some(port) => Some(port.parse::<u16>().ok().filter(|port| *port > 0)?),
        None => None,
    };
    Some((user, host, port))
}

fn is_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.starts_with('/')
        || path.starts_with('\\')
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'\\' | b'/'))
}

fn local_user() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default()
}

/// 读取本机 `~/.ssh/config` 生成预览。
fn preview_default() -> AppResult<OpenSshImportPreview> {
    let ssh_dir = keys::ssh_dir()?;
    let home = dirs::home_dir()
        .map(|home| home.to_string_lossy().into_owned())
        .unwrap_or_default();
    let path = ssh_dir.join("config");
    let display = path.display().to_string();

    let source = FsSource;
    let text = match source.read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            return Ok(OpenSshImportPreview {
                path: display,
                found: false,
                hosts: Vec::new(),
                warnings: Vec::new(),
            });
        }
        Err(err) => {
            return Err(AppError::invalid_input(format!(
                "读取 {display} 失败：{err}"
            )))
        }
    };

    let ctx = ParseContext {
        ssh_dir,
        home,
        local_user: local_user(),
        windows_paths: cfg!(windows),
    };
    let (mut hosts, warnings) = parse_config(&text, "config", &source, &ctx, Some(path));

    // 私钥文件不存在不阻止导入，但要提醒用户导入后连不上的原因
    for host in &mut hosts {
        if let Some(identity) = &host.identity_file {
            if !Path::new(identity).is_file() {
                host.warnings
                    .push(warning("identityFileMissing", identity.clone()));
            }
        }
    }

    Ok(OpenSshImportPreview {
        path: display,
        found: true,
        hosts,
        warnings,
    })
}

/// 预览本机 `~/.ssh/config` 中可导入的主机。
#[tauri::command]
pub async fn ssh_config_preview(window: WebviewWindow) -> AppResult<OpenSshImportPreview> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(preview_default)
        .await
        .map_err(|_| AppError::internal("读取 SSH 配置任务失败"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// 内存文件系统：键为 `/` 分隔的绝对路径。
    #[derive(Default)]
    struct MemSource(HashMap<String, String>);

    impl MemSource {
        fn with(mut self, path: &str, text: &str) -> Self {
            self.0.insert(path.to_string(), text.to_string());
            self
        }
    }

    fn key(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    impl ConfigSource for MemSource {
        fn read_to_string(&self, path: &Path) -> io::Result<String> {
            self.0
                .get(&key(path))
                .cloned()
                .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
        }

        fn list_dir(&self, dir: &Path) -> io::Result<Vec<String>> {
            let prefix = format!("{}/", key(dir));
            Ok(self
                .0
                .keys()
                .filter_map(|path| path.strip_prefix(&prefix))
                .filter(|name| !name.contains('/'))
                .map(str::to_string)
                .collect())
        }
    }

    fn ctx() -> ParseContext {
        ParseContext {
            ssh_dir: PathBuf::from("/home/me/.ssh"),
            home: "/home/me".to_string(),
            local_user: "me".to_string(),
            windows_paths: false,
        }
    }

    fn parse(text: &str, source: &MemSource) -> (Vec<OpenSshHost>, Vec<OpenSshWarning>) {
        parse_config(text, "config", source, &ctx(), None)
    }

    fn host<'a>(hosts: &'a [OpenSshHost], alias: &str) -> &'a OpenSshHost {
        hosts
            .iter()
            .find(|host| host.alias == alias)
            .unwrap_or_else(|| panic!("缺少主机 {alias}"))
    }

    fn kinds(warnings: &[OpenSshWarning]) -> Vec<&str> {
        warnings.iter().map(|w| w.kind.as_str()).collect()
    }

    #[test]
    fn parses_multiple_hosts_and_patterns_on_one_line() {
        let text = "\
Host web db
    HostName 10.0.0.%h
    User deploy

Host cache
    HostName cache.internal
    Port 2222
";
        let (hosts, warnings) = parse(text, &MemSource::default());
        assert!(warnings.is_empty());
        assert_eq!(
            hosts.iter().map(|h| h.alias.as_str()).collect::<Vec<_>>(),
            ["web", "db", "cache"]
        );
        assert_eq!(host(&hosts, "web").host, "10.0.0.web");
        assert_eq!(host(&hosts, "db").user, "deploy");
        assert_eq!(host(&hosts, "cache").port, 2222);
        // 未配置 User 时沿用本机用户名，并给出提示
        assert_eq!(host(&hosts, "cache").user, "me");
        assert_eq!(kinds(&host(&hosts, "cache").warnings), ["userDefaulted"]);
    }

    #[test]
    fn wildcard_blocks_provide_defaults_but_are_not_imported() {
        let text = "\
Host prod-*
    User ops
Host prod-api
    HostName api.example.com
Host *
    User fallback
    Port 2200
    IdentityFile ~/.ssh/id_ed25519
Host dev !dev-*
    HostName dev.local
";
        let (hosts, _) = parse(text, &MemSource::default());
        assert_eq!(
            hosts.iter().map(|h| h.alias.as_str()).collect::<Vec<_>>(),
            ["prod-api", "dev"]
        );
        let api = host(&hosts, "prod-api");
        assert_eq!(api.user, "ops");
        assert_eq!(api.port, 2200);
        assert_eq!(api.identity_file.as_deref(), Some("/home/me/.ssh/id_ed25519"));
        assert_eq!(host(&hosts, "dev").user, "fallback");
    }

    #[test]
    fn first_obtained_value_wins() {
        let text = "\
Port 2022
Host box
    Port 3022
    User first
    User second
    IdentityFile /keys/a
    IdentityFile /keys/b
Host *
    User third
";
        let (hosts, _) = parse(text, &MemSource::default());
        let item = host(&hosts, "box");
        // 全局段在最前，比 Host 块里的值更早出现
        assert_eq!(item.port, 2022);
        assert_eq!(item.user, "first");
        assert_eq!(item.identity_file.as_deref(), Some("/keys/a"));
        assert!(kinds(&item.warnings).contains(&"multipleIdentityFiles"));
    }

    #[test]
    fn keywords_are_case_insensitive_and_accept_equals_and_quotes() {
        let text = "\
HOST=quoted
  hostname=\"my host.example\"
  USER = 'svc account'
  identityFile \"/keys/with space\"   # 行尾注释
  pOrT=2201
";
        let (hosts, warnings) = parse(text, &MemSource::default());
        assert!(warnings.is_empty());
        let item = host(&hosts, "quoted");
        assert_eq!(item.host, "my host.example");
        assert_eq!(item.user, "svc account");
        assert_eq!(item.port, 2201);
        assert_eq!(item.identity_file.as_deref(), Some("/keys/with space"));
    }

    #[test]
    fn reports_unterminated_quotes() {
        let (hosts, warnings) = parse("Host a\n  User \"oops\n", &MemSource::default());
        assert_eq!(kinds(&warnings), ["syntax"]);
        assert_eq!(host(&hosts, "a").user, "me");
    }

    #[test]
    fn expands_identity_tokens() {
        let text = "\
Host box
    HostName box.example
    User admin
    IdentityFile %d/.ssh/%u-%r@%h_%%
";
        let (hosts, warnings) = parse(text, &MemSource::default());
        assert!(warnings.is_empty());
        assert_eq!(
            host(&hosts, "box").identity_file.as_deref(),
            Some("/home/me/.ssh/me-admin@box.example_%")
        );
    }

    #[test]
    fn windows_paths_use_backslashes() {
        let ctx = ParseContext {
            ssh_dir: PathBuf::from("C:/Users/me/.ssh"),
            home: "C:\\Users\\me".to_string(),
            local_user: "me".to_string(),
            windows_paths: true,
        };
        let text = "Host w\n  IdentityFile ~/.ssh/id_rsa\nHost x\n  IdentityFile C:\\keys\\id\n";
        let (hosts, _) = parse_config(text, "config", &MemSource::default(), &ctx, None);
        assert_eq!(
            host(&hosts, "w").identity_file.as_deref(),
            Some("C:\\Users\\me\\.ssh\\id_rsa")
        );
        assert_eq!(host(&hosts, "x").identity_file.as_deref(), Some("C:\\keys\\id"));
        assert!(host(&hosts, "x").warnings.iter().all(|w| w.kind != "relativeIdentityFile"));
    }

    #[test]
    fn include_supports_globs_relative_to_ssh_dir() {
        let source = MemSource::default()
            .with("/home/me/.ssh/conf.d/b.conf", "Host beta\n  HostName b.example\n")
            .with("/home/me/.ssh/conf.d/a.conf", "Host alpha\n  HostName a.example\n")
            .with("/home/me/.ssh/conf.d/skip.txt", "Host ignored\n")
            .with("/home/me/.ssh/extra", "Host gamma\n  User g\n");
        let text = "\
Include conf.d/*.conf ~/.ssh/extra /home/me/.ssh/missing
Host *
    User shared
";
        let (hosts, warnings) = parse(text, &source);
        assert!(warnings.is_empty());
        assert_eq!(
            hosts.iter().map(|h| h.alias.as_str()).collect::<Vec<_>>(),
            ["alpha", "beta", "gamma"]
        );
        assert_eq!(host(&hosts, "alpha").host, "a.example");
        assert_eq!(host(&hosts, "alpha").user, "shared");
        assert_eq!(host(&hosts, "gamma").user, "g");
    }

    #[test]
    fn include_inside_host_block_is_conditional() {
        let source = MemSource::default().with("/home/me/.ssh/common", "User scoped\n");
        let text = "\
Host one
    Include common
    Port 2201
Host two
";
        let (hosts, _) = parse(text, &source);
        assert_eq!(host(&hosts, "one").user, "scoped");
        // Include 返回后仍处于 `Host one` 作用域
        assert_eq!(host(&hosts, "one").port, 2201);
        assert_eq!(host(&hosts, "two").user, "me");
        assert_eq!(host(&hosts, "two").port, 22);
    }

    #[test]
    fn include_cycles_are_stopped() {
        let source = MemSource::default()
            .with("/home/me/.ssh/a", "Include b\nHost from-a\n")
            .with("/home/me/.ssh/b", "Include a\nHost from-b\n");
        let (hosts, warnings) = parse("Include a\n", &source);
        assert_eq!(
            hosts.iter().map(|h| h.alias.as_str()).collect::<Vec<_>>(),
            ["from-b", "from-a"]
        );
        assert_eq!(kinds(&warnings), ["includeCycle"]);
    }

    #[test]
    fn proxy_jump_resolves_aliases_and_flattens_chains() {
        let text = "\
Host bastion
    HostName bastion.example.com
    User jump
    Port 2222
Host inner-gw
    HostName 10.1.0.1
    ProxyJump bastion
Host app
    HostName 10.2.0.5
    ProxyJump inner-gw,ops@[2001:db8::1]:2200
Host direct
    ProxyJump other@bastion:22
";
        let (hosts, _) = parse(text, &MemSource::default());

        let app = host(&hosts, "app");
        assert_eq!(app.jump.len(), 3);
        assert_eq!(app.jump[0].alias.as_deref(), Some("bastion"));
        assert_eq!(app.jump[0].host, "bastion.example.com");
        assert_eq!(app.jump[0].port, 2222);
        assert_eq!(app.jump[0].user, "jump");
        assert_eq!(app.jump[1].alias.as_deref(), Some("inner-gw"));
        assert_eq!(app.jump[1].host, "10.1.0.1");
        assert_eq!(app.jump[1].user, "me");
        assert_eq!(app.jump[2].alias, None);
        assert_eq!(app.jump[2].host, "2001:db8::1");
        assert_eq!(app.jump[2].port, 2200);
        assert_eq!(app.jump[2].user, "ops");

        // 显式的 user / port 覆盖别名配置
        let direct = host(&hosts, "direct");
        assert_eq!(direct.jump.len(), 1);
        assert_eq!(direct.jump[0].alias.as_deref(), Some("bastion"));
        assert_eq!(direct.jump[0].user, "other");
        assert_eq!(direct.jump[0].port, 22);
    }

    #[test]
    fn proxy_jump_cycles_and_proxy_command_become_warnings() {
        let text = "\
Host a
    ProxyJump b
Host b
    ProxyJump a
Host c
    ProxyCommand ssh -W %h:%p gateway
    ProxyJump a
Host d
    ProxyJump none
Host e
    ProxyJump bad@
";
        let (hosts, _) = parse(text, &MemSource::default());
        assert!(host(&hosts, "a").jump.is_empty());
        assert_eq!(kinds(&host(&hosts, "a").warnings), ["userDefaulted", "jumpCycle"]);
        let c = host(&hosts, "c");
        assert!(c.jump.is_empty());
        assert_eq!(c.warnings[1].kind, "proxyCommand");
        assert_eq!(c.warnings[1].detail, "ssh -W %h:%p gateway");
        assert_eq!(kinds(&host(&hosts, "d").warnings), ["userDefaulted"]);
        assert!(kinds(&host(&hosts, "e").warnings).contains(&"jumpInvalid"));
    }

    #[test]
    fn match_blocks_are_skipped_with_warning() {
        let text = "\
Host keep
    User a
Match host keep exec \"true\"
    User from-match
    Port 9999
Host after
    User b
";
        let (hosts, warnings) = parse(text, &MemSource::default());
        assert_eq!(kinds(&warnings), ["matchSkipped"]);
        assert!(warnings[0].detail.starts_with("config:3"));
        assert_eq!(host(&hosts, "keep").user, "a");
        assert_eq!(host(&hosts, "keep").port, 22);
        assert_eq!(host(&hosts, "after").user, "b");
    }

    #[test]
    fn invalid_port_and_forwards_warn() {
        let text = "Host p\n  Port abc\n  LocalForward 8080 localhost:80\n";
        let (hosts, _) = parse(text, &MemSource::default());
        let item = host(&hosts, "p");
        assert_eq!(item.port, 22);
        assert!(kinds(&item.warnings).contains(&"invalidPort"));
        assert!(kinds(&item.warnings).contains(&"forwardIgnored"));
    }

    #[test]
    fn wildcard_matching() {
        assert!(wildcard_match("*.example.com", "A.Example.com", true));
        assert!(wildcard_match("web-??", "web-01", true));
        assert!(!wildcard_match("web-??", "web-1", true));
        assert!(wildcard_match("*a*b*", "xxaxxbxx", true));
        assert!(!wildcard_match("*.conf", "a.CONF", false));
        assert!(host_patterns_match(&["*".into(), "!secret".into()], "public"));
        assert!(!host_patterns_match(&["*".into(), "!secret".into()], "secret"));
        assert!(!host_patterns_match(&["!secret".into()], "public"));
    }
}
