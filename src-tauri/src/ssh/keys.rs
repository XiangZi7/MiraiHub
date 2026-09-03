//! 本地 SSH 密钥管理：扫描、生成、删除。
//!
//! 只碰 `~/.ssh` 目录。私钥内容从不离开这一层 ——
//! 对外暴露的 `SshKeyInfo` 只含公钥、指纹这类公开信息。

use std::fs;
use std::path::{Path, PathBuf};

use russh::keys::{Algorithm, EcdsaCurve, HashAlg, PrivateKey, PublicKey};

use super::error::{SshError, SshResult};
use super::models::{GenerateKeyRequest, SshKeyInfo, SshKeyKind};

/// 扫描时跳过的文件：这些不是私钥。
const SKIP_FILES: &[&str] = &[
    "known_hosts",
    "known_hosts.old",
    "authorized_keys",
    "config",
    "agent.env",
];

/// 定位 `~/.ssh`。目录不存在时不创建 —— 扫描场景下空目录和不存在等价。
pub fn ssh_dir() -> SshResult<PathBuf> {
    dirs::home_dir()
        .map(|home| home.join(".ssh"))
        .ok_or(SshError::NoHomeDir)
}

/// 确保 `~/.ssh` 存在，返回其路径。生成密钥前调用。
fn ensure_ssh_dir() -> SshResult<PathBuf> {
    let dir = ssh_dir()?;
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
        restrict_dir_permissions(&dir)?;
    }
    Ok(dir)
}

/// 扫描 `~/.ssh` 下的所有私钥。
///
/// 判定标准是"存在同名 .pub 公钥"，而不是去试解析每个文件：
/// 私钥可能带口令解不开，但公钥总是明文可读的，
/// 这样加密私钥也能被正常列出，且不必向用户索要口令。
pub fn list_keys() -> SshResult<Vec<SshKeyInfo>> {
    let dir = ssh_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut keys = Vec::new();

    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };

        // 公钥自身、以及已知的非密钥文件都跳过
        if name.ends_with(".pub") || SKIP_FILES.contains(&name) {
            continue;
        }

        // 没有配套公钥的，不认为是密钥
        let pub_path = path.with_file_name(format!("{name}.pub"));
        if !pub_path.exists() {
            continue;
        }

        match read_key_info(&path, &pub_path) {
            Ok(info) => keys.push(info),
            // 单个密钥读失败不该让整个列表挂掉，记日志跳过
            Err(err) => log::warn!("跳过密钥 {}：{err}", path.display()),
        }
    }

    // 按修改时间倒序：最近生成/使用的排前面
    keys.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

    Ok(keys)
}

/// 读取单个密钥对的信息。
fn read_key_info(private_path: &Path, public_path: &Path) -> SshResult<SshKeyInfo> {
    let pub_text = fs::read_to_string(public_path)?;
    let pub_text = pub_text.trim();

    let public_key = PublicKey::from_openssh(pub_text).map_err(|source| SshError::KeyParse {
        path: public_path.display().to_string(),
        source,
    })?;

    // 注释在 PublicKey 里，但 OpenSSH 公钥文件的第三段才是完整注释，
    // 优先取文件里的原文，解析结果作兜底
    let comment = pub_text
        .split_whitespace()
        .nth(2)
        .map(str::to_owned)
        .unwrap_or_else(|| public_key.comment().to_owned());

    let label = private_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_owned();

    let modified_at = fs::metadata(private_path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|dur| dur.as_millis() as i64)
        .unwrap_or_default();

    Ok(SshKeyInfo {
        id: private_path.display().to_string(),
        label,
        kind: kind_of(public_key.algorithm()),
        bits: bits_of(&public_key),
        fingerprint: public_key.fingerprint(HashAlg::Sha256).to_string(),
        public_key: pub_text.to_owned(),
        comment,
        encrypted: is_encrypted(private_path)?,
        modified_at,
    })
}

/// 私钥是否带口令。
///
/// 直接读文件头判断，而不是尝试空口令解密：
/// 后者对某些实现会触发耗时的 KDF 计算，扫描整个目录时代价明显。
fn is_encrypted(path: &Path) -> SshResult<bool> {
    let text = fs::read_to_string(path)?;

    // 传统 PEM 格式：带 Proc-Type: 4,ENCRYPTED 头
    if text.contains("ENCRYPTED") {
        return Ok(true);
    }

    // OpenSSH 新格式：解析后看 is_encrypted 标志，
    // 这一步只解外层结构、不做 KDF，很快
    match PrivateKey::from_openssh(&text) {
        Ok(key) => Ok(key.is_encrypted()),
        // 解不开多半就是加密的，保守报 true
        Err(_) => Ok(true),
    }
}

/// russh 的算法枚举 → 我们对外的三分类。
fn kind_of(algorithm: Algorithm) -> SshKeyKind {
    match algorithm {
        Algorithm::Ed25519 => SshKeyKind::Ed25519,
        Algorithm::Ecdsa { .. } => SshKeyKind::Ecdsa,
        // Rsa 及其余（含 SK 变体）统一归到 rsa 展示
        _ => SshKeyKind::Rsa,
    }
}

/// 密钥位数。
fn bits_of(key: &PublicKey) -> u32 {
    match key.algorithm() {
        Algorithm::Ed25519 => 256,
        Algorithm::Ecdsa { curve } => match curve {
            EcdsaCurve::NistP256 => 256,
            EcdsaCurve::NistP384 => 384,
            EcdsaCurve::NistP521 => 521,
        },
        // RSA 的位数要从模数长度算，拿不到时按最常见的 3072 兜底
        _ => key
            .key_data()
            .rsa()
            .map(|rsa| (rsa.n.as_bytes().len() * 8) as u32)
            .unwrap_or(3072),
    }
}

/// 生成新密钥对，写入 `~/.ssh`。
pub fn generate_key(request: &GenerateKeyRequest) -> SshResult<SshKeyInfo> {
    validate_label(&request.label)?;

    let dir = ensure_ssh_dir()?;
    let private_path = dir.join(&request.label);
    let public_path = dir.join(format!("{}.pub", request.label));

    // 不覆盖已有密钥：覆盖等于把用户既有的授权全废掉，必须显式先删
    if private_path.exists() || public_path.exists() {
        return Err(SshError::KeyExists(request.label.clone()));
    }

    let algorithm = match request.kind {
        SshKeyKind::Ed25519 => Algorithm::Ed25519,
        SshKeyKind::Rsa => Algorithm::Rsa {
            hash: Some(HashAlg::Sha256),
        },
        SshKeyKind::Ecdsa => Algorithm::Ecdsa {
            curve: EcdsaCurve::NistP256,
        },
    };

    let mut private_key = PrivateKey::random(&mut rand::thread_rng(), algorithm)?;

    let comment = request
        .comment
        .clone()
        .unwrap_or_else(default_comment);
    private_key.set_comment(&comment);

    // 空口令视为不加密：前端把"不设口令"表达成空串更自然
    let passphrase = request
        .passphrase
        .as_deref()
        .filter(|value| !value.is_empty());

    let private_pem = match passphrase {
        Some(pass) => private_key.encrypt(&mut rand::thread_rng(), pass)?.to_openssh(russh::keys::ssh_key::LineEnding::LF)?,
        None => private_key.to_openssh(russh::keys::ssh_key::LineEnding::LF)?,
    };

    fs::write(&private_path, private_pem.as_bytes())?;
    // 私钥必须先收权限再谈其他：OpenSSH 会拒绝使用组/其他可读的私钥
    restrict_file_permissions(&private_path)?;

    let public_openssh = private_key.public_key().to_openssh()?;
    fs::write(&public_path, format!("{public_openssh}\n"))?;

    read_key_info(&private_path, &public_path)
}

/// 删除密钥对。私钥与同名 .pub 一起删。
pub fn delete_key(key_id: &str) -> SshResult<()> {
    let private_path = PathBuf::from(key_id);

    // 只允许删 ~/.ssh 里的文件：key_id 来自前端，
    // 不校验的话一个构造过的路径就能删掉任意文件
    let dir = ssh_dir()?;
    let canonical_dir = dir.canonicalize().map_err(SshError::Io)?;
    let canonical_key = private_path
        .canonicalize()
        .map_err(|_| SshError::KeyNotFound(key_id.to_owned()))?;

    if !canonical_key.starts_with(&canonical_dir) {
        return Err(SshError::InvalidInput(format!(
            "拒绝删除 ~/.ssh 之外的文件：{key_id}"
        )));
    }

    if !canonical_key.is_file() {
        return Err(SshError::KeyNotFound(key_id.to_owned()));
    }

    let public_path = canonical_key.with_file_name(format!(
        "{}.pub",
        canonical_key
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
    ));

    fs::remove_file(&canonical_key)?;

    // 公钥可能已经不在了，删不掉不算错
    if public_path.exists() {
        let _ = fs::remove_file(&public_path);
    }

    Ok(())
}

/// 校验密钥名：必须是纯文件名，不能借此写到 ~/.ssh 之外。
fn validate_label(label: &str) -> SshResult<()> {
    if label.trim().is_empty() {
        return Err(SshError::InvalidInput("密钥名不能为空".into()));
    }

    if label.contains('/') || label.contains('\\') || label.contains("..") {
        return Err(SshError::InvalidInput(
            "密钥名不能包含路径分隔符或 ..".into(),
        ));
    }

    if label.ends_with(".pub") {
        return Err(SshError::InvalidInput(
            "密钥名不能以 .pub 结尾，公钥会自动生成".into(),
        ));
    }

    Ok(())
}

/// 默认公钥注释：`user@hostname`，与 ssh-keygen 的习惯一致。
fn default_comment() -> String {
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "user".to_owned());

    let host = hostname_or_default();

    format!("{user}@{host}")
}

fn hostname_or_default() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "miraihub".to_owned())
}

/// 把私钥权限收成 0600。
///
/// Windows 上 NTFS ACL 与 Unix 权限位模型不同，
/// 且 Windows 版 OpenSSH 不做这项检查，故只在 Unix 上处理。
#[cfg(unix)]
fn restrict_file_permissions(path: &Path) -> SshResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_file_permissions(_path: &Path) -> SshResult<()> {
    Ok(())
}

#[cfg(unix)]
fn restrict_dir_permissions(path: &Path) -> SshResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_dir_permissions(_path: &Path) -> SshResult<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal_in_label() {
        assert!(validate_label("../evil").is_err());
        assert!(validate_label("sub/key").is_err());
        assert!(validate_label("key.pub").is_err());
        assert!(validate_label("  ").is_err());
    }

    #[test]
    fn accepts_normal_label() {
        assert!(validate_label("id_ed25519").is_ok());
        assert!(validate_label("deploy_rsa").is_ok());
    }
}
