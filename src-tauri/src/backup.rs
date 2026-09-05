//! Portable connection archives. Credentials require passphrase encryption.
use crate::error::{AppError, AppResult};
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::WebviewWindow;
const MAX: usize = 8 * 1024 * 1024;
const AAD: &[u8] = b"MiraiHub connection backup v1 / Argon2id / AES-256-GCM";
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    format: String,
    version: u32,
    kdf: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}
fn window_guard(window: &WebviewWindow) -> AppResult<()> {
    if !matches!(window.label(), "main" | "settings") {
        Err(AppError::invalid_input("此窗口无权备份或恢复连接"))
    } else {
        Ok(())
    }
}
fn key(password: &str, salt: &[u8]) -> AppResult<[u8; 32]> {
    if password.len() < 10 || password.len() > 1024 {
        return Err(AppError::invalid_input("备份密码需为 10–1024 字节"));
    }
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|_| AppError::internal("备份密钥派生失败"))?;
    Ok(key)
}
fn redact(value: &mut Value) {
    match value {
        Value::Object(object) => {
            for (key, value) in object.iter_mut() {
                if matches!(
                    key.as_str(),
                    "password" | "passphrase" | "apiKey" | "startupCommand"
                ) {
                    *value = Value::String(String::new());
                } else {
                    redact(value);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                redact(item);
            }
        }
        _ => {}
    }
}
fn valid_payload(payload: &Value) -> AppResult<()> {
    if payload["format"] != "miraihub-connections"
        || payload["version"] != 1
        || !payload["connections"].is_array()
        || !payload["groups"].is_array()
        || !payload["tags"].is_array()
    {
        return Err(AppError::invalid_input("不是受支持的 MiraiHub 连接备份"));
    }
    Ok(())
}
fn pack(mut payload: Value, password: &str) -> AppResult<Vec<u8>> {
    valid_payload(&payload)?;
    if password.is_empty() {
        redact(&mut payload);
        payload["includesCredentials"] = false.into();
    }
    let bytes =
        serde_json::to_vec_pretty(&payload).map_err(|_| AppError::internal("无法编码连接备份"))?;
    if bytes.len() > MAX {
        return Err(AppError::invalid_input("备份超过 8 MB 限制"));
    }
    if password.is_empty() {
        return Ok(bytes);
    }
    use rand::RngCore;
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let mut secret = key(password, &salt)?;
    let cipher =
        Aes256Gcm::new_from_slice(&secret).map_err(|_| AppError::internal("初始化加密失败"))?;
    secret.fill(0);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &bytes,
                aad: AAD,
            },
        )
        .map_err(|_| AppError::internal("备份加密失败"))?;
    serde_json::to_vec_pretty(&Envelope {
        format: "miraihub-encrypted-connections".into(),
        version: 1,
        kdf: "argon2id-v19-m19456-t2-p1".into(),
        salt: STANDARD.encode(salt),
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    })
    .map_err(|_| AppError::internal("无法编码加密备份"))
}
fn unpack(bytes: &[u8], password: &str) -> AppResult<Value> {
    if bytes.len() > MAX * 2 {
        return Err(AppError::invalid_input("备份文件过大"));
    }
    let mut payload: Value =
        serde_json::from_slice(bytes).map_err(|_| AppError::invalid_input("备份不是有效 JSON"))?;
    if payload["format"] == "miraihub-encrypted-connections" {
        let envelope: Envelope = serde_json::from_value(payload)
            .map_err(|_| AppError::invalid_input("加密备份格式无效"))?;
        if envelope.version != 1 || envelope.kdf != "argon2id-v19-m19456-t2-p1" {
            return Err(AppError::invalid_input("不支持的加密备份版本"));
        }
        let invalid = || AppError::invalid_input("密码错误或备份文件损坏");
        let salt = STANDARD.decode(&envelope.salt).map_err(|_| invalid())?;
        let nonce = STANDARD.decode(&envelope.nonce).map_err(|_| invalid())?;
        let ciphertext = STANDARD
            .decode(&envelope.ciphertext)
            .map_err(|_| invalid())?;
        if salt.len() != 16 || nonce.len() != 12 || ciphertext.len() > MAX + 16 {
            return Err(invalid());
        }
        let mut secret = key(password, &salt)?;
        let cipher = Aes256Gcm::new_from_slice(&secret).map_err(|_| invalid())?;
        secret.fill(0);
        let plain = cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: AAD,
                },
            )
            .map_err(|_| invalid())?;
        payload = serde_json::from_slice(&plain).map_err(|_| invalid())?;
    }
    valid_payload(&payload)?;
    Ok(payload)
}
fn write_archive(target: &std::path::Path, bytes: &[u8]) -> AppResult<()> {
    use std::io::Write;
    if !target.is_absolute() || target.file_name().is_none() {
        return Err(AppError::invalid_input("请选择备份保存位置"));
    }
    let parent = target
        .parent()
        .ok_or_else(|| AppError::invalid_input("备份路径无效"))?;
    let temporary = parent.join(format!(
        ".mirai-backup-{}.tmp",
        crate::ssh::tunnels::random_id()
    ));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, target)?;
        Ok::<_, std::io::Error>(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(AppError::from)
}
#[tauri::command]
pub async fn connection_backup_write(
    window: WebviewWindow,
    path: String,
    payload: Value,
    password: String,
) -> AppResult<()> {
    window_guard(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = pack(payload, &password)?;
        write_archive(std::path::Path::new(&path), &bytes)
    })
    .await
    .map_err(|_| AppError::internal("备份任务失败"))?
}
#[tauri::command]
pub async fn connection_backup_read(
    window: WebviewWindow,
    path: String,
    password: String,
) -> AppResult<Value> {
    window_guard(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let file = std::fs::File::open(path)?;
        if file.metadata()?.len() > (MAX * 2) as u64 {
            return Err(AppError::invalid_input("备份文件过大"));
        }
        let mut bytes = Vec::new();
        file.take((MAX * 2 + 1) as u64).read_to_end(&mut bytes)?;
        unpack(&bytes, &password)
    })
    .await
    .map_err(|_| AppError::internal("读取备份失败"))?
}
#[cfg(test)]
mod tests {
    use super::*;
    fn payload() -> Value {
        serde_json::json!({"format":"miraihub-connections","version":1,"connections":[{"settings":{"password":"private-test","auth":{"passphrase":"private-key-test"},"startupCommand":"echo private"}}],"groups":[],"tags":[],"includesCredentials":true})
    }
    #[test]
    fn plain_archives_never_include_credentials() {
        let bytes = pack(payload(), "").unwrap();
        let text = String::from_utf8(bytes.clone()).unwrap();
        assert!(!text.contains("private-test"));
        assert!(!text.contains("private-key-test"));
        assert!(!text.contains("echo private"));
        assert_eq!(unpack(&bytes, "").unwrap()["includesCredentials"], false);
    }
    #[test]
    fn encrypted_archive_is_portable_and_authenticated() {
        let bytes = pack(payload(), "test-password-long").unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("private-test"));
        assert_eq!(unpack(&bytes, "test-password-long").unwrap(), payload());
        assert!(unpack(&bytes, "incorrect-password").is_err());
        let mut envelope: Value = serde_json::from_slice(&bytes).unwrap();
        envelope["nonce"] = STANDARD.encode([0u8; 12]).into();
        assert!(unpack(
            &serde_json::to_vec(&envelope).unwrap(),
            "test-password-long"
        )
        .is_err());
    }
    #[test]
    fn rejects_unknown_versions_and_short_passwords() {
        let mut p = payload();
        p["version"] = 99.into();
        assert!(pack(p, "").is_err());
        assert!(pack(payload(), "short").is_err());
        assert!(unpack(b"garbage", "").is_err());
    }
}

#[cfg(test)]
mod write_tests {
    use super::*;
    #[test]
    fn replacement_keeps_old_archive_until_success() {
        let root = std::env::temp_dir().join(format!(
            "mirai-archive-test-{}",
            crate::ssh::tunnels::random_id()
        ));
        std::fs::create_dir(&root).unwrap();
        let target = root.join("backup.json");
        write_archive(&target, b"first").unwrap();
        write_archive(&target, b"second").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"second");
        let directory = root.join("directory");
        std::fs::create_dir(&directory).unwrap();
        assert!(write_archive(&directory, b"invalid").is_err());
        assert!(directory.is_dir());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 2);
        std::fs::remove_file(target).unwrap();
        std::fs::remove_dir(directory).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
