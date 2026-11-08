//! 把本地公钥部署到远端 `~/.ssh/authorized_keys`，相当于 `ssh-copy-id`。
//!
//! 走已建立会话的 exec 通道执行一段 POSIX sh 脚本：
//! 建目录、收紧权限、按公钥数据去重后追加。公钥内容来自本机 `~/.ssh` 下的 `.pub`，
//! 前端只传密钥 id（私钥路径），不经手公钥文本，也就没法借此注入任意命令。

use std::{fs, path::PathBuf, time::Duration};

use russh::keys::{HashAlg, PublicKey};
use serde::Serialize;
use tauri::State;

use crate::error::{AppError, AppResult};

use super::{keys, manager::SessionManager, shell};

/// 远端脚本在 stdout 上报告结果的标记
const MARK_ADDED: &str = "MIRAIHUB_KEY_ADDED";
const MARK_EXISTS: &str = "MIRAIHUB_KEY_EXISTS";
const MARK_FAILED: &str = "MIRAIHUB_KEY_FAILED";
/// 远端脚本的执行时限：exec 本身没有超时，远端卡住（如家目录挂载失效）时不能让前端一直等
const DEPLOY_TIMEOUT: Duration = Duration::from_secs(60);

/// 部署结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployKeyResult {
    /// `added`：新追加；`exists`：远端已存在同一公钥，未改动文件
    pub status: String,
    /// 部署的公钥指纹（SHA256），便于前端提示
    pub fingerprint: String,
}

/// 规范化后的公钥行。
#[derive(Debug, Clone, PartialEq, Eq)]
struct PublicKeyLine {
    /// 写入 authorized_keys 的整行：`算法 base64 [注释]`
    line: String,
    /// 只含 base64 数据部分，用于去重
    blob: String,
    fingerprint: String,
}

/// 解析并校验一行 OpenSSH 公钥文本。
///
/// 只接受单行、无控制字符、能被解析的公钥；注释原样保留（可能含空格或引号，
/// 后面统一做单引号转义）。
fn normalize_public_key(text: &str) -> AppResult<PublicKeyLine> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::invalid_input("公钥文件为空"));
    }
    if text.chars().any(|ch| ch.is_control() && ch != '\t') {
        return Err(AppError::invalid_input("公钥只能是单行文本"));
    }

    let key = PublicKey::from_openssh(text)
        .map_err(|err| AppError::invalid_input(format!("公钥格式无效：{err}")))?;

    let mut parts = text.split_whitespace();
    let algorithm = parts.next().unwrap_or_default();
    let blob = parts.next().unwrap_or_default();
    let comment = parts.collect::<Vec<_>>().join(" ");
    if blob.is_empty() || !blob.chars().all(|ch| ch.is_ascii_alphanumeric() || "+/=".contains(ch)) {
        return Err(AppError::invalid_input("公钥数据不是合法的 base64"));
    }

    let line = if comment.is_empty() {
        format!("{algorithm} {blob}")
    } else {
        format!("{algorithm} {blob} {comment}")
    };

    Ok(PublicKeyLine {
        line,
        blob: blob.to_string(),
        fingerprint: key.fingerprint(HashAlg::Sha256).to_string(),
    })
}

/// 读取本地私钥对应的 `.pub`。`key_id` 是私钥路径，必须位于 `~/.ssh` 之内。
fn read_local_public_key(key_id: &str) -> AppResult<PublicKeyLine> {
    let dir = keys::ssh_dir()?;
    let canonical_dir = dir
        .canonicalize()
        .map_err(|_| AppError::not_found("本机 ~/.ssh 目录不存在"))?;
    let canonical_key = PathBuf::from(key_id)
        .canonicalize()
        .map_err(|_| AppError::not_found(format!("密钥不存在：{key_id}")))?;
    if !canonical_key.starts_with(&canonical_dir) {
        return Err(AppError::invalid_input("只能部署 ~/.ssh 中的密钥"));
    }

    let file_name = canonical_key
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let public_path = if file_name.ends_with(".pub") {
        canonical_key.clone()
    } else {
        canonical_key.with_file_name(format!("{file_name}.pub"))
    };

    let text = fs::read_to_string(&public_path)
        .map_err(|_| AppError::not_found(format!("找不到公钥文件：{}", public_path.display())))?;
    normalize_public_key(&text)
}

/// 生成远端执行的部署脚本（外层再用 `sh -c` 包一次，不依赖用户的登录 shell 语法）。
///
/// - 脚本写成单行（`;` 分隔）：csh / tcsh 登录 shell 不接受单引号内的换行
/// - `umask 077` 保证新建的目录 / 文件默认就是私有权限
/// - 按 base64 数据去重（忽略 `#` 注释行）：同一把钥匙即使注释不同、前面带了 options 也视为已存在
/// - 文件末尾没有换行时先补一个，避免新公钥拼到上一行后面
/// - 追加用 `printf '%s\n'`，公钥文本只作为参数出现，不会被解释
/// - 失败时在 stdout 打出 `MIRAIHUB_KEY_FAILED=<code>`：exec 收到 EOF 即返回，退出码可能拿不到
fn build_deploy_command(key: &PublicKeyLine) -> String {
    let fail = |code: u32| format!("{{ echo {MARK_FAILED}={code}; exit {code}; }}");
    let script = [
        "umask 077".to_string(),
        format!(
            "mkdir -p \"$HOME/.ssh\" && chmod 700 \"$HOME/.ssh\" || {}",
            fail(11)
        ),
        "f=\"$HOME/.ssh/authorized_keys\"".to_string(),
        format!("k={}", shell::quote(&key.line)),
        format!("b={}", shell::quote(&key.blob)),
        format!("touch \"$f\" && chmod 600 \"$f\" || {}", fail(12)),
        format!(
            "if grep -v '^[[:space:]]*#' \"$f\" | grep -qF -e \"$b\"; then echo {MARK_EXISTS}; exit 0; fi"
        ),
        format!(
            "if [ -s \"$f\" ] && [ -n \"$(tail -c 1 \"$f\")\" ]; then printf '\\n' >> \"$f\" || {}; fi",
            fail(13)
        ),
        format!("printf '%s\\n' \"$k\" >> \"$f\" || {}", fail(13)),
        "chmod 600 \"$f\"".to_string(),
        format!("echo {MARK_ADDED}"),
    ]
    .join("; ");
    format!("sh -c {}", shell::quote(&script))
}

/// 根据脚本输出判断结果。
fn parse_deploy_output(stdout: &str, stderr: &str, exit_code: Option<u32>) -> AppResult<&'static str> {
    if stdout.lines().any(|line| line.trim() == MARK_EXISTS) {
        return Ok("exists");
    }
    if stdout.lines().any(|line| line.trim() == MARK_ADDED) {
        return Ok("added");
    }

    // 退出码丢失时以脚本自报的失败码为准
    let reported = stdout.lines().find_map(|line| {
        line.trim()
            .strip_prefix(MARK_FAILED)
            .and_then(|rest| rest.strip_prefix('='))
            .and_then(|code| code.parse::<u32>().ok())
    });
    let reason = match reported.or(exit_code) {
        Some(11) => "无法创建或设置远端 ~/.ssh 目录权限".to_string(),
        Some(12) => "无法创建或设置 authorized_keys 权限".to_string(),
        Some(13) => "写入 authorized_keys 失败".to_string(),
        _ => "远端未返回部署结果".to_string(),
    };
    let detail = stderr.trim();
    Err(AppError::internal(if detail.is_empty() {
        reason
    } else {
        format!("{reason}：{}", detail.chars().take(500).collect::<String>())
    }))
}

/// 把本地公钥部署到会话所连服务器的 `~/.ssh/authorized_keys`。
///
/// 前端负责按已保存连接建立（并在结束后断开）会话，这里只做 exec。
#[tauri::command]
pub async fn ssh_deploy_public_key(
    manager: State<'_, SessionManager>,
    session_id: String,
    key_id: String,
) -> AppResult<DeployKeyResult> {
    let key = read_local_public_key(&key_id)?;
    let session = manager.get(&session_id).await?;
    // exec 默认 30 秒超时，这里放宽到部署上限之外，由外层计时给出部署专用提示
    let command = build_deploy_command(&key);
    let exec = session.exec_timeout(&command, DEPLOY_TIMEOUT + Duration::from_secs(1));
    let output = tokio::time::timeout(DEPLOY_TIMEOUT, exec)
        .await
        .map_err(|_| AppError::internal("部署公钥超时，远端未在 60 秒内返回"))??;
    let status = parse_deploy_output(&output.stdout, &output.stderr, output.exit_code)?;

    Ok(DeployKeyResult {
        status: status.to_string(),
        fingerprint: key.fingerprint,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ED25519: &str =
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";

    #[test]
    fn normalizes_public_key_and_keeps_comment() {
        let key = normalize_public_key(&format!("  {ED25519}   me@my host \n")).unwrap();
        assert_eq!(key.line, format!("{ED25519} me@my host"));
        assert_eq!(
            key.blob,
            "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"
        );
        assert!(key.fingerprint.starts_with("SHA256:"));
    }

    #[test]
    fn rejects_multiline_or_invalid_keys() {
        assert!(normalize_public_key("").is_err());
        assert!(normalize_public_key(&format!("{ED25519}\nrm -rf /")).is_err());
        assert!(normalize_public_key("ssh-ed25519 not-base64!").is_err());
    }

    #[test]
    fn command_quotes_key_with_single_quotes() {
        let key = normalize_public_key(&format!("{ED25519} it's $(whoami) `id`")).unwrap();
        let command = build_deploy_command(&key);
        assert!(command.starts_with("sh -c '"));
        // 注释里的单引号在脚本层与外层 sh -c 层各转义一次
        assert!(!command.contains("it's"));
        assert!(command.contains("printf '\\''%s\\n'\\''"));
        assert!(command.contains("grep -qF -e"));
        assert!(command.contains("chmod 700"));
        assert!(command.contains("chmod 600"));
    }

    #[test]
    fn script_round_trips_through_quote() {
        // 去掉外层 sh -c 引号后应还原出原脚本：模拟 shell 对单引号字面量的解析
        let key = normalize_public_key(&format!("{ED25519} a'b")).unwrap();
        let command = build_deploy_command(&key);
        let quoted = command.strip_prefix("sh -c ").unwrap();
        let script = unquote(quoted);
        assert!(script.contains(&format!("k={}", shell::quote(&key.line))));
        assert!(script.contains("printf '%s\\n' \"$k\" >> \"$f\""));
    }

    /// 解析由 `shell::quote` 生成的单引号串（仅支持 `'...'` 与 `\'` 拼接）。
    fn unquote(input: &str) -> String {
        let mut out = String::new();
        let mut chars = input.chars().peekable();
        let mut in_quote = false;
        while let Some(ch) = chars.next() {
            match ch {
                '\'' => in_quote = !in_quote,
                '\\' if !in_quote => {
                    if let Some(next) = chars.next() {
                        out.push(next);
                    }
                }
                _ => out.push(ch),
            }
        }
        out
    }

    #[test]
    fn parses_script_output() {
        assert_eq!(parse_deploy_output("MIRAIHUB_KEY_ADDED\n", "", Some(0)).unwrap(), "added");
        assert_eq!(parse_deploy_output("motd\nMIRAIHUB_KEY_EXISTS\n", "", None).unwrap(), "exists");
        let err = parse_deploy_output("", "Permission denied", Some(12)).unwrap_err();
        assert!(err.message.contains("authorized_keys"));
        assert!(err.message.contains("Permission denied"));
        // 退出码丢失时按脚本自报的失败码给出原因
        let err = parse_deploy_output("MIRAIHUB_KEY_FAILED=13\n", "", None).unwrap_err();
        assert!(err.message.contains("写入 authorized_keys 失败"));
    }

    #[test]
    fn command_is_single_line_and_skips_comment_lines() {
        let key = normalize_public_key(ED25519).unwrap();
        let command = build_deploy_command(&key);
        assert!(!command.contains('\n'));
        let script = unquote(command.strip_prefix("sh -c ").unwrap());
        assert!(script.contains("grep -v '^[[:space:]]*#' \"$f\" | grep -qF -e \"$b\""));
        assert!(script.contains("{ echo MIRAIHUB_KEY_FAILED=11; exit 11; }"));
    }
}
