//! Bounded UTF-8 configuration edits, with original-content checks and a retained backup.
use super::{policy::Action, Cell};
use crate::{
    error::{AppError, AppResult},
    ssh::{editor, session::SshSession},
};
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;

pub const LIMIT: usize = 64000;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub before: String,
    pub after: String,
}
pub fn validate_path(path: &str) -> AppResult<()> {
    if !path.starts_with('/')
        || path.ends_with('/')
        || path.len() > 4096
        || path.chars().any(char::is_control)
        || path.split('/').any(|part| part == "..")
    {
        return Err(AppError::invalid_input("请提供有效的远端文件绝对路径"));
    }
    Ok(())
}
pub fn validate_text(text: &str) -> AppResult<()> {
    if text.len() > LIMIT
        || text.contains('\r')
        || text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\t'))
    {
        return Err(AppError::invalid_input(
            "配置文本须为 64 KB 以内的 UTF-8 文本，使用 LF 换行",
        ));
    }
    Ok(())
}
pub fn ensure_original(actual: &str, expected: &str) -> AppResult<()> {
    if actual != expected {
        return Err(AppError::invalid_input(
            "远端文件与差异预览的原文不一致，未写入；请重新读取后提议修改",
        ));
    }
    Ok(())
}
pub async fn read(session: &SshSession, path: &str) -> AppResult<Value> {
    validate_path(path)?;
    let sftp = session.open_sftp().await?;
    let (bytes, _) = editor::read_file(&sftp, path).await?;
    let (text, ending, bom) = editor::decode(&bytes)?;
    validate_text(&text)?;
    Ok(json!({"path":path,"text":text,"lineEnding":ending,"bom":bom}))
}
pub async fn apply(session: &SshSession, change: &FileChange, cell: &Cell) -> AppResult<Value> {
    validate_path(&change.path)?;
    validate_text(&change.before)?;
    validate_text(&change.after)?;
    let sftp = session.open_sftp().await?;
    let (original, _) = editor::read_file(&sftp, &change.path).await?;
    let (text, ending, bom) = editor::decode(&original)?;
    ensure_original(&text, &change.before)?;
    let replacement = editor::encode(&change.after, &ending, bom)?;
    if original == replacement {
        return Ok(json!({"path":change.path,"changed":false}));
    }
    let backup = format!("{}.miraihub-{}.bak", change.path, super::id());
    let mut file = sftp
        .open_with_flags(
            &backup,
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUDE,
        )
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;
    // Backups may contain secrets; set owner-only access before writing any bytes.
    let mut attrs = FileAttributes::empty();
    attrs.permissions = Some(0o600);
    file.set_metadata(attrs)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;
    file.write_all(&original).await?;
    file.flush().await?;
    file.sync_all()
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;
    file.shutdown().await?;
    let operation = async {
        let (current, _) = editor::read_file(&sftp, &change.path).await?;
        if current != original {
            return Err(AppError::invalid_input("备份期间远端文件发生变化，未写入"));
        }
        if cell.cancelled.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(AppError::invalid_input("任务已停止，未写入配置"));
        }
        editor::write_file(&sftp, &change.path, &replacement).await?;
        let (written, _) = editor::read_file(&sftp, &change.path).await?;
        if written != replacement {
            return Err(AppError::internal("写入后内容核对不一致"));
        }
        Ok::<(), AppError>(())
    }
    .await;
    operation
        .map_err(|error| AppError::internal(format!("{}；原文备份：{}", error.message, backup)))?;
    Ok(json!({"path":change.path,"changed":true,"verified":true,"backupPath":backup}))
}
impl Action {
    pub fn file_change(&self) -> Option<FileChange> {
        if let Self::FileEdit {
            path,
            expected,
            content,
            ..
        } = self
        {
            Some(FileChange {
                path: path.clone(),
                before: expected.clone(),
                after: content.clone(),
            })
        } else {
            None
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configuration_edits_are_bounded_and_require_exact_original_text() {
        assert!(validate_path("/etc/nginx/nginx.conf").is_ok());
        for path in ["relative", "/etc/../secret", "/etc/a\0b", "/etc/"] {
            assert!(validate_path(path).is_err());
        }
        for text in ["x".repeat(LIMIT + 1), "bad\0text".into(), "a\r\n".into()] {
            assert!(validate_text(&text).is_err());
        }
        assert!(validate_text("").is_ok());
        assert!(ensure_original("a\n", "a\n").is_ok());
        assert!(ensure_original("a\n", "a").is_err());
    }
    #[test]
    fn file_tools_are_scoped_and_preserve_single_use_approval_policy() {
        let registry = super::super::mcp::Registry::build("ssh", &[]);
        let args = json!({"path":"/etc/nginx.conf","expected":"listen 80;\n","content":"listen 8080;\n","reason":"change port"}).to_string();
        let action =
            super::super::policy::classify(&registry, "ssh", "propose_file_edit", &args).unwrap();
        for mode in [
            super::super::policy::ApprovalMode::Ask,
            super::super::policy::ApprovalMode::Auto,
        ] {
            assert!(mode.requires_approval(&action));
        }
        assert!(!super::super::policy::ApprovalMode::Full.requires_approval(&action));
        let change = action.file_change().unwrap();
        assert_eq!(change.before, "listen 80;\n");
        assert_eq!(change.after, "listen 8080;\n");
        assert!(
            super::super::policy::classify(&registry, "database", "propose_file_edit", &args)
                .is_err()
        );
        assert!(super::super::policy::classify(
            &registry,
            "ssh",
            "propose_file_edit",
            &args.replace("/etc/nginx.conf", "/etc/../nginx.conf")
        )
        .is_err());
        let escaped = json!({
            "path":"/etc/demo.conf",
            "expected":"\\".repeat(LIMIT),
            "content":"\t".repeat(LIMIT),
            "reason":"Preserve a complete escaped original"
        })
        .to_string();
        assert!(
            super::super::policy::classify(&registry, "ssh", "propose_file_edit", &escaped).is_ok()
        );
    }
}
