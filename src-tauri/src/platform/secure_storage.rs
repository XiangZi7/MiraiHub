//! macOS Keychain / Linux Secret Service 保存主密钥，文件内容使用 AES-GCM 加密。

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use rand::RngCore;

use crate::error::{AppError, AppResult};

const HEADER: &[u8] = b"MHSEC\x01";
const NONCE_LENGTH: usize = 12;

/// 为配置、聊天和附件共用一个用户级主密钥；解密时绝不创建替代密钥。
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub fn protect(bytes: &[u8], encrypt: bool) -> AppResult<Vec<u8>> {
    use std::sync::Mutex;
    static KEY: Mutex<Option<[u8; 32]>> = Mutex::new(None);
    let mut cached = KEY
        .lock()
        .map_err(|_| AppError::internal("系统密钥存储锁不可用"))?;
    if cached.is_none() {
        let service = if cfg!(dev) {
            "com.admin.miraihub.dev"
        } else {
            "com.admin.miraihub"
        };
        let entry = keyring::Entry::new(service, "ai-storage-key-v1")
            .map_err(|error| AppError::internal(format!("无法打开系统密钥存储：{error}")))?;
        let secret = match entry.get_secret() {
            Ok(secret) => secret,
            Err(keyring::Error::NoEntry) if encrypt => {
                let mut key = [0u8; 32];
                rand::rngs::OsRng.fill_bytes(&mut key);
                entry.set_secret(&key).map_err(|error| {
                    AppError::internal(format!(
                        "无法保存系统密钥，请解锁钥匙串或启用 Secret Service：{error}"
                    ))
                })?;
                key.to_vec()
            }
            Err(error) => {
                return Err(AppError::internal(format!(
                    "无法读取系统密钥，请解锁钥匙串或启用 Secret Service：{error}"
                )))
            }
        };
        *cached = Some(
            secret
                .try_into()
                .map_err(|_| AppError::internal("系统存储中的加密密钥长度无效"))?,
        );
    }
    let key = cached.as_ref().expect("master key initialized");
    protect_with_key(bytes, encrypt, key)
}

/// 使用版本头和随机 nonce 加密文件，并在解密时拒绝错误密钥、截断或篡改数据。
fn protect_with_key(bytes: &[u8], encrypt: bool, key: &[u8; 32]) -> AppResult<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| AppError::internal("加密密钥无效"))?;
    if encrypt {
        let mut nonce = [0u8; NONCE_LENGTH];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let encrypted = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: bytes,
                    aad: HEADER,
                },
            )
            .map_err(|_| AppError::internal("本地数据加密失败"))?;
        Ok([HEADER, nonce.as_slice(), encrypted.as_slice()].concat())
    } else {
        if bytes.len() < HEADER.len() + NONCE_LENGTH + 16 || !bytes.starts_with(HEADER) {
            return Err(AppError::invalid_input("加密文件格式无效"));
        }
        let offset = HEADER.len() + NONCE_LENGTH;
        cipher
            .decrypt(
                Nonce::from_slice(&bytes[HEADER.len()..offset]),
                Payload {
                    msg: &bytes[offset..],
                    aad: HEADER,
                },
            )
            .map_err(|_| AppError::internal("本地数据解密失败，密钥不匹配或文件已损坏"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 无需访问真实钥匙串，验证配置和大附件的加密、随机性及完整性保护。
    #[test]
    fn encrypted_files_round_trip_and_reject_tampering() {
        let key = [42; 32];
        for plain in [
            Vec::new(),
            b"private configuration".to_vec(),
            vec![7; 1024 * 1024],
        ] {
            let encrypted = protect_with_key(&plain, true, &key).unwrap();
            assert_eq!(protect_with_key(&encrypted, false, &key).unwrap(), plain);
            assert_ne!(encrypted, protect_with_key(&plain, true, &key).unwrap());
            assert!(protect_with_key(&encrypted, false, &[43; 32]).is_err());
            assert!(protect_with_key(&encrypted[..encrypted.len() - 1], false, &key).is_err());
            let mut changed = encrypted;
            *changed.last_mut().unwrap() ^= 1;
            assert!(protect_with_key(&changed, false, &key).is_err());
        }
        assert!(protect_with_key(b"plaintext", false, &key).is_err());
    }
}
