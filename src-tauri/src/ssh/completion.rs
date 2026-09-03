//! 交互式终端的命令与路径补全。
//!
//! 补全走独立 exec channel，不向正在使用的 PTY 注入探测命令，
//! 因此不会污染用户的终端输出或命令历史。

use std::collections::HashSet;

use serde::Serialize;

use super::error::SshResult;
use super::files;
use super::session::SshSession;
use super::shell::quote;

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

pub async fn suggestions(
    session: &SshSession,
    line: &str,
    cwd: &str,
) -> SshResult<Vec<ShellSuggestion>> {
    let token = current_token(line);
    if token.is_empty() {
        return Ok(Vec::new());
    }

    let command_position = line.trim_start() == token;
    let mut results = Vec::new();

    if command_position && !looks_like_path(token) {
        results.extend(command_suggestions(session, token).await?);
    }

    results.extend(path_suggestions(session, token, cwd).await);

    let mut seen = HashSet::new();
    results.retain(|item| seen.insert((item.kind_label(), item.value.clone())));
    results.truncate(12);
    Ok(results)
}

async fn command_suggestions(
    session: &SshSession,
    prefix: &str,
) -> SshResult<Vec<ShellSuggestion>> {
    // compgen 是 bash builtin。用 bash -lc 包一层，同时把用户输入经过两层单引号转义，
    // 前缀中的空格、分号、命令替换等都只能作为字面量参与匹配。
    let inner = format!(
        "compgen -c -- {} 2>/dev/null | LC_ALL=C sort -u | head -n 12",
        quote(prefix)
    );
    let output = session.exec(&format!("bash -lc {}", quote(&inner))).await?;

    if output.exit_code.unwrap_or(0) != 0 {
        return Ok(Vec::new());
    }

    Ok(output
        .stdout
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| ShellSuggestion {
            value: name.to_owned(),
            label: name.to_owned(),
            kind: SuggestionKind::Command,
            description: command_description(name).to_owned(),
        })
        .collect())
}

async fn path_suggestions(session: &SshSession, token: &str, cwd: &str) -> Vec<ShellSuggestion> {
    let (directory_part, prefix) = split_path_token(token);
    let target = directory_target(directory_part, cwd);

    let Ok(listing) = files::list_directory(session, &target).await else {
        return Vec::new();
    };

    let prefix_lower = prefix.to_locale_lowercase();
    let mut entries = listing
        .entries
        .into_iter()
        .filter(|entry| entry.name.to_locale_lowercase().starts_with(&prefix_lower))
        .collect::<Vec<_>>();

    entries.sort_by(|a, b| {
        let a_rank = matches!(a.kind, files::FileKind::Directory | files::FileKind::Symlink);
        let b_rank = matches!(b.kind, files::FileKind::Directory | files::FileKind::Symlink);
        b_rank.cmp(&a_rank).then_with(|| a.name.cmp(&b.name))
    });

    entries
        .into_iter()
        .take(8)
        .map(|entry| {
            let directory = matches!(entry.kind, files::FileKind::Directory);
            let suffix = if directory { "/" } else { "" };
            ShellSuggestion {
                value: format!("{directory_part}{}{suffix}", entry.name),
                label: entry.name,
                kind: if directory {
                    SuggestionKind::Directory
                } else {
                    SuggestionKind::File
                },
                description: if directory {
                    "远端目录".to_owned()
                } else {
                    "远端文件".to_owned()
                },
            }
        })
        .collect()
}

fn current_token(line: &str) -> &str {
    if line.ends_with(char::is_whitespace) {
        return "";
    }

    line.rsplit_once(char::is_whitespace)
        .map(|(_, token)| token)
        .unwrap_or(line)
}

fn looks_like_path(token: &str) -> bool {
    token.contains('/') || token.starts_with('.') || token.starts_with('~')
}

fn split_path_token(token: &str) -> (&str, &str) {
    match token.rsplit_once('/') {
        Some((directory, prefix)) => {
            let directory_end = token.len() - prefix.len();
            (&token[..directory_end], prefix)
        }
        None => ("", token),
    }
}

fn directory_target(directory_part: &str, cwd: &str) -> String {
    let directory = directory_part.trim_end_matches('/');
    if directory_part.starts_with('/') {
        return if directory.is_empty() { "/" } else { directory }.to_owned();
    }
    if directory_part.starts_with('~') {
        return directory.to_owned();
    }
    if directory.is_empty() {
        return cwd.to_owned();
    }
    if cwd.is_empty() {
        return directory.to_owned();
    }

    format!("{}/{}", cwd.trim_end_matches('/'), directory)
}

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

    #[test]
    fn extracts_current_token() {
        assert_eq!(current_token("dock"), "dock");
        assert_eq!(current_token("cd /var/lo"), "/var/lo");
        assert_eq!(current_token("ls "), "");
    }

    #[test]
    fn splits_path_prefix() {
        assert_eq!(split_path_token("/var/lo"), ("/var/", "lo"));
        assert_eq!(split_path_token("src"), ("", "src"));
    }

    #[test]
    fn resolves_relative_directory() {
        assert_eq!(directory_target("", "/root"), "/root");
        assert_eq!(directory_target("src/", "/root"), "/root/src");
        assert_eq!(directory_target("/var/", "/root"), "/var");
    }
}

