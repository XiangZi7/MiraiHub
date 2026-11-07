//! known_hosts 的检查与替换：区分“未知主机”与“密钥已变化”，供连接时弹窗确认。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use russh::keys::known_hosts::{
    check_known_hosts_path, known_host_keys_path, learn_known_hosts_path,
};
use russh::keys::{Error, PublicKey};

/// 主机密钥与 known_hosts 的比对结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyCheck {
    /// 已记录且一致
    Trusted,
    /// 没有该主机（或该算法）的记录
    Unknown,
    /// 同算法的记录与当前密钥不一致，可能遭遇中间人攻击
    Changed { old_fingerprint: Option<String> },
}

/// 与 OpenSSH 一致的 ~/.ssh/known_hosts。
pub fn default_path() -> Result<PathBuf, Error> {
    let home = dirs::home_dir().ok_or(Error::NoHomeDir)?;
    Ok(home.join(".ssh").join("known_hosts"))
}

/// SHA256 指纹，形如 `SHA256:xxxx`。
pub fn fingerprint(key: &PublicKey) -> String {
    key.fingerprint(Default::default()).to_string()
}

pub fn check(host: &str, port: u16, key: &PublicKey, path: &Path) -> Result<HostKeyCheck, Error> {
    match check_known_hosts_path(host, port, key, path) {
        Ok(true) => Ok(HostKeyCheck::Trusted),
        Ok(false) => Ok(HostKeyCheck::Unknown),
        Err(Error::KeyChanged { .. }) => {
            let old_fingerprint = known_host_keys_path(host, port, path)?
                .into_iter()
                .find(|(_, recorded)| recorded.algorithm() == key.algorithm())
                .map(|(_, recorded)| fingerprint(&recorded));
            Ok(HostKeyCheck::Changed { old_fingerprint })
        }
        Err(error) => Err(error),
    }
}

/// 追加记录（首次信任）。
pub fn learn(host: &str, port: u16, key: &PublicKey, path: &Path) -> Result<(), Error> {
    learn_known_hosts_path(host, port, key, path)
}

/// 用新密钥替换该主机同算法的旧记录，其余行（注释、其他主机、其他算法）原样保留。
pub fn replace(host: &str, port: u16, key: &PublicKey, path: &Path) -> Result<(), Error> {
    let stale: HashSet<usize> = known_host_keys_path(host, port, path)?
        .into_iter()
        .filter(|(_, recorded)| recorded.algorithm() == key.algorithm())
        .map(|(line, _)| line)
        .collect();
    if !stale.is_empty() {
        let content = std::fs::read_to_string(path)?;
        let mut kept = String::with_capacity(content.len());
        // 行号与 russh 的计数方式一致：注释行不计数，从 1 开始
        let mut line = 1;
        for raw in content.split_inclusive('\n') {
            if raw.starts_with('#') {
                kept.push_str(raw);
                continue;
            }
            if !stale.contains(&line) {
                kept.push_str(raw);
            }
            line += 1;
        }
        // 先写临时文件再改名，写一半崩溃也不会把整份 known_hosts 弄坏
        let temp = path.with_extension("miraihub-tmp");
        std::fs::write(&temp, kept)?;
        std::fs::rename(&temp, path)?;
    }
    learn_known_hosts_path(host, port, key, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn random_key() -> PublicKey {
        russh::keys::PrivateKey::random(&mut rand::rngs::OsRng, russh::keys::Algorithm::Ed25519)
            .unwrap()
            .public_key()
            .clone()
    }

    fn temp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "miraihub-known-hosts-{}-{name}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("known_hosts");
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn unknown_then_trusted_after_learning() {
        let path = temp_file("learn");
        let key = random_key();
        assert_eq!(check("a.example", 2222, &key, &path).unwrap(), HostKeyCheck::Unknown);
        learn("a.example", 2222, &key, &path).unwrap();
        assert_eq!(check("a.example", 2222, &key, &path).unwrap(), HostKeyCheck::Trusted);
        // 端口不同视为另一台主机
        assert_eq!(check("a.example", 22, &key, &path).unwrap(), HostKeyCheck::Unknown);
    }

    #[test]
    fn changed_key_reports_old_fingerprint_and_replace_keeps_other_lines() {
        let path = temp_file("replace");
        let old = random_key();
        let other = random_key();
        let new = random_key();
        std::fs::write(&path, "# comment line\n").unwrap();
        learn("b.example", 22, &other, &path).unwrap();
        learn("a.example", 22, &old, &path).unwrap();

        assert_eq!(
            check("a.example", 22, &new, &path).unwrap(),
            HostKeyCheck::Changed {
                old_fingerprint: Some(fingerprint(&old))
            }
        );

        replace("a.example", 22, &new, &path).unwrap();
        assert_eq!(check("a.example", 22, &new, &path).unwrap(), HostKeyCheck::Trusted);
        assert_eq!(check("b.example", 22, &other, &path).unwrap(), HostKeyCheck::Trusted);
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.starts_with("# comment line\n"));
        assert_eq!(content.matches("a.example").count(), 1);
    }

    #[test]
    fn fingerprint_uses_sha256() {
        assert!(fingerprint(&random_key()).starts_with("SHA256:"));
    }
}
