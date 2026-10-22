//! Encrypted, chunked text attachments. Callers serialize operations with the agent
//! manager's attachment mutex and run filesystem work off the async executor.
//! `app_data` is the trusted application data directory, never a model/user path.
use super::config;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

pub(super) const MAX_FILE_BYTES: u64 = 1_000_000_000;
pub(super) const MAX_TOTAL_BYTES: u64 = 1_000_000_000;
pub(super) const MAX_FILES: usize = 16;
pub(super) const MAX_CHUNK_BYTES: usize = 256 * 1024;
pub(super) const MAX_READ_BYTES: usize = 12_000;
const MAX_PREVIEW_BYTES: usize = 2_048;
const MAX_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;
const MAX_CHUNKS: usize = 65_536;
const MAX_SEARCH_BYTES: usize = 1024 * 1024;
const MAX_SEARCH_SCAN_BYTES: usize = 64 * 1024 * 1024;
const MAX_QUERY_BYTES: usize = 1024;
const DRAFT_RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRef {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub preview: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadPage {
    pub id: String,
    pub name: String,
    /// Actual UTF-8 boundary, which can precede the requested offset by 1–3 bytes.
    pub offset: u64,
    pub end_offset: u64,
    pub next_offset: Option<u64>,
    pub total_bytes: u64,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub offset: u64,
    pub end_offset: u64,
    /// The complete matching text; use read() for surrounding context.
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub id: String,
    pub name: String,
    pub matches: Vec<SearchMatch>,
    /// Continue even when this page has no matches: scanning is bounded per call.
    pub next_offset: Option<u64>,
    pub total_bytes: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    version: u8,
    id: String,
    name: String,
    size: u64,
    chunks: Vec<usize>,
    preview: String,
    has_text: bool,
    finished: bool,
    conversation_id: Option<String>,
}

impl Manifest {
    fn reference(&self) -> AttachmentRef {
        AttachmentRef {
            id: self.id.clone(),
            name: self.name.clone(),
            size: self.size,
            preview: self.preview.clone(),
        }
    }

    fn can_read(&self, conversation_id: &str, allow_draft: bool) -> AppResult<()> {
        valid_id(conversation_id)?;
        if !self.finished {
            return Err(AppError::invalid_input("附件尚未上传完成"));
        }
        match self.conversation_id.as_deref() {
            Some(owner) if owner == conversation_id => Ok(()),
            None if allow_draft => Ok(()),
            _ => Err(AppError::invalid_input("此附件不属于当前聊天会话")),
        }
    }
}

fn valid_id(id: &str) -> AppResult<()> {
    if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::invalid_input("无效的附件或聊天会话 ID"));
    }
    Ok(())
}

fn valid_name(name: &str) -> AppResult<()> {
    if name.trim().is_empty()
        || name.len() > 255
        || name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err(AppError::invalid_input("附件文件名无效"));
    }
    Ok(())
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0 // Includes directory junctions.
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn checked_directory(path: &Path) -> AppResult<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() || is_link(&metadata) {
        return Err(AppError::invalid_input("附件存储目录无效"));
    }
    Ok(())
}

fn root(app_data: &Path, create: bool) -> AppResult<PathBuf> {
    let root = app_data.join("ai-attachments");
    if create {
        fs::create_dir_all(&root)?;
    }
    if root.exists() {
        checked_directory(&root)?;
    }
    Ok(root)
}

fn attachment_directory(app_data: &Path, id: &str) -> AppResult<PathBuf> {
    valid_id(id)?;
    let path = root(app_data, false)?.join(id);
    checked_directory(&path)?;
    Ok(path)
}

fn read_encrypted(path: &Path, max_bytes: u64) -> AppResult<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || is_link(&metadata) || metadata.len() > max_bytes {
        return Err(AppError::invalid_input("附件文件无效或已损坏"));
    }
    config::protect(&fs::read(path)?, false)
}

fn write_encrypted(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let encrypted = config::protect(bytes, true)?;
    // A caller-held mutex ensures no concurrent writer owns this temporary path.
    let temporary = path.with_extension("tmp");
    for candidate in [path, temporary.as_path()] {
        if let Ok(metadata) = fs::symlink_metadata(candidate) {
            if !metadata.is_file() || is_link(&metadata) {
                return Err(AppError::invalid_input("附件存储文件无效"));
            }
        }
    }
    let mut file = fs::File::create(&temporary)?;
    file.write_all(&encrypted)?;
    file.sync_all()?;
    drop(file);
    fs::rename(temporary, path)?;
    Ok(())
}

fn read_manifest(directory: &Path, id: &str) -> AppResult<Manifest> {
    let bytes = read_encrypted(&directory.join("manifest.bin"), MAX_MANIFEST_BYTES)?;
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| AppError::invalid_input("附件元数据已损坏"))?;
    valid_name(&manifest.name)?;
    let total = manifest.chunks.iter().try_fold(0u64, |total, &size| {
        (size > 0 && size <= MAX_CHUNK_BYTES)
            .then(|| total.checked_add(size as u64))
            .flatten()
    });
    if manifest.version != 1
        || manifest.id != id
        || manifest.chunks.len() > MAX_CHUNKS
        || manifest.size > MAX_FILE_BYTES
        || total != Some(manifest.size)
        || manifest.preview.len() > MAX_PREVIEW_BYTES
        || (manifest.finished && (!manifest.has_text || manifest.size == 0))
        || manifest
            .conversation_id
            .as_deref()
            .is_some_and(|id| valid_id(id).is_err())
    {
        return Err(AppError::invalid_input("附件元数据已损坏"));
    }
    Ok(manifest)
}

fn write_manifest(directory: &Path, manifest: &Manifest) -> AppResult<()> {
    let bytes =
        serde_json::to_vec(manifest).map_err(|_| AppError::internal("无法保存附件元数据"))?;
    write_encrypted(&directory.join("manifest.bin"), &bytes)
}

fn load(app_data: &Path, id: &str) -> AppResult<(PathBuf, Manifest)> {
    let directory = attachment_directory(app_data, id)?;
    let manifest = read_manifest(&directory, id)?;
    Ok((directory, manifest))
}

fn chunk_path(directory: &Path, index: usize) -> PathBuf {
    directory.join(format!("chunk-{index:06}.bin"))
}

fn read_chunk(directory: &Path, manifest: &Manifest, index: usize) -> AppResult<String> {
    let bytes = read_encrypted(
        &chunk_path(directory, index),
        (MAX_CHUNK_BYTES + 65_536) as u64,
    )?;
    if bytes.len() != manifest.chunks[index] {
        return Err(AppError::invalid_input("附件分块已损坏"));
    }
    String::from_utf8(bytes).map_err(|_| AppError::invalid_input("附件分块不是 UTF-8 文本"))
}

fn new_id() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Begin one local draft; the 16-file / 1 GB aggregate quota applies per bind batch.
pub(super) fn begin(app_data: &Path, name: &str) -> AppResult<String> {
    valid_name(name)?;
    let storage = root(app_data, true)?;
    // Failed cleanup must not prevent a new upload; damaged or unattributable
    // directories are deliberately left untouched.
    let _ = cleanup_unbound(app_data, SystemTime::now());
    let id = new_id();
    let directory = storage.join(&id);
    fs::create_dir(&directory)?;
    let manifest = Manifest {
        version: 1,
        id: id.clone(),
        name: name.to_owned(),
        size: 0,
        chunks: Vec::new(),
        preview: String::new(),
        has_text: false,
        finished: false,
        conversation_id: None,
    };
    if let Err(error) = write_manifest(&directory, &manifest) {
        let _ = remove_directory(&storage, &directory);
        return Err(error);
    }
    Ok(id)
}

pub(super) fn append(app_data: &Path, id: &str, index: usize, content: &str) -> AppResult<()> {
    if content.is_empty() || content.len() > MAX_CHUNK_BYTES {
        return Err(AppError::invalid_input(
            "每个附件分块须为 1–262144 字节 UTF-8 文本",
        ));
    }
    if content
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(AppError::invalid_input("附件不支持二进制或控制字符"));
    }
    let (directory, mut manifest) = load(app_data, id)?;
    if manifest.finished || manifest.conversation_id.is_some() {
        return Err(AppError::invalid_input("附件已完成，不能继续上传"));
    }
    if index != manifest.chunks.len() || index >= MAX_CHUNKS {
        return Err(AppError::invalid_input(
            "附件分块序号不连续或分块过多，请重新上传",
        ));
    }
    let size = manifest
        .size
        .checked_add(content.len() as u64)
        .filter(|size| *size <= MAX_FILE_BYTES)
        .ok_or_else(|| AppError::invalid_input("单个附件不能超过 1 GB"))?;
    write_encrypted(&chunk_path(&directory, index), content.as_bytes())?;
    let preview_is_complete = manifest.preview.len() as u64 == manifest.size;
    manifest.size = size;
    manifest.chunks.push(content.len());
    manifest.has_text |= !content.trim().is_empty();
    if preview_is_complete {
        let remaining = MAX_PREVIEW_BYTES.saturating_sub(manifest.preview.len());
        let mut end = remaining.min(content.len());
        while !content.is_char_boundary(end) {
            end -= 1;
        }
        manifest.preview.push_str(&content[..end]);
    }
    // An unreferenced chunk left by an interrupted manifest write is safely replaced
    // at the same expected index on retry; committed chunks are never overwritten.
    write_manifest(&directory, &manifest)
}

pub(super) fn finish(app_data: &Path, id: &str) -> AppResult<AttachmentRef> {
    let (directory, mut manifest) = load(app_data, id)?;
    if manifest.conversation_id.is_some() {
        return Err(AppError::invalid_input("附件已归属聊天会话"));
    }
    if !manifest.has_text || manifest.size == 0 {
        return Err(AppError::invalid_input("请选择非空的文本附件"));
    }
    if !manifest.finished {
        manifest.finished = true;
        write_manifest(&directory, &manifest)?;
    }
    Ok(manifest.reference())
}

/// Verify the resolved deletion target is one direct child of the storage root.
fn remove_directory(storage: &Path, directory: &Path) -> AppResult<()> {
    checked_directory(storage)?;
    checked_directory(directory)?;
    let storage = fs::canonicalize(storage)?;
    let directory = fs::canonicalize(directory)?;
    if directory.parent() != Some(storage.as_path()) {
        return Err(AppError::invalid_input("附件目录超出存储范围"));
    }
    fs::remove_dir_all(directory)?;
    Ok(())
}

pub(super) fn discard(app_data: &Path, id: &str) -> AppResult<()> {
    let (directory, manifest) = load(app_data, id)?;
    if manifest.conversation_id.is_some() {
        return Err(AppError::invalid_input("已发送的附件只能随聊天记录删除"));
    }
    remove_directory(&root(app_data, false)?, &directory)
}

/// Compatibility path for an already-small text input; still writes bounded blocks.
pub(super) fn store_text(app_data: &Path, name: &str, content: &str) -> AppResult<AttachmentRef> {
    if content.len() as u64 > MAX_FILE_BYTES {
        return Err(AppError::invalid_input("单个附件不能超过 1 GB"));
    }
    let id = begin(app_data, name)?;
    let result = (|| {
        let mut offset = 0;
        let mut index = 0;
        while offset < content.len() {
            let mut end = (offset + MAX_CHUNK_BYTES).min(content.len());
            while !content.is_char_boundary(end) {
                end -= 1;
            }
            append(app_data, &id, index, &content[offset..end])?;
            offset = end;
            index += 1;
        }
        finish(app_data, &id)
    })();
    if result.is_err() {
        let _ = discard(app_data, &id);
    }
    result
}

/// Inspect completed drafts before message admission without claiming ownership.
pub(super) fn inspect(
    app_data: &Path,
    conversation_id: &str,
    id: &str,
) -> AppResult<AttachmentRef> {
    let (_, manifest) = load(app_data, id)?;
    manifest.can_read(conversation_id, true)?;
    Ok(manifest.reference())
}

pub(super) fn bind(
    app_data: &Path,
    conversation_id: &str,
    ids: &[String],
) -> AppResult<Vec<AttachmentRef>> {
    valid_id(conversation_id)?;
    if ids.len() > MAX_FILES {
        return Err(AppError::invalid_input("每条消息最多添加 16 个附件"));
    }
    let mut seen = HashSet::new();
    let mut loaded = Vec::new();
    let mut total = 0u64;
    for id in ids {
        if !seen.insert(id) {
            continue;
        }
        let (directory, manifest) = load(app_data, id)?;
        manifest.can_read(conversation_id, true)?;
        total = total
            .checked_add(manifest.size)
            .filter(|total| *total <= MAX_TOTAL_BYTES)
            .ok_or_else(|| AppError::invalid_input("每条消息的附件总大小不能超过 1 GB"))?;
        loaded.push((directory, manifest));
    }
    // Validate every reference before claiming any draft. Restore previous claims
    // on a recoverable persistence failure, so rejected sends can be retried.
    let mut changed = Vec::new();
    for (index, (directory, original)) in loaded.iter().enumerate() {
        if original.conversation_id.is_some() {
            continue;
        }
        let mut manifest = original.clone();
        manifest.conversation_id = Some(conversation_id.to_owned());
        if let Err(error) = write_manifest(directory, &manifest) {
            for &index in &changed {
                let (directory, original): &(PathBuf, Manifest) = &loaded[index];
                let _ = write_manifest(directory, original);
            }
            return Err(error);
        }
        changed.push(index);
    }
    Ok(loaded
        .into_iter()
        .map(|(_, manifest)| manifest.reference())
        .collect())
}

/// A bounded UTF-8 window. Chunk boundaries are already valid UTF-8 boundaries.
fn window(
    directory: &Path,
    manifest: &Manifest,
    offset: u64,
    limit: usize,
) -> AppResult<(u64, String)> {
    if offset > manifest.size {
        return Err(AppError::invalid_input("读取位置超过附件大小"));
    }
    let mut base = 0u64;
    let mut start = offset;
    let mut content = String::with_capacity(limit.min(MAX_SEARCH_BYTES + MAX_QUERY_BYTES + 4));
    for (index, &size) in manifest.chunks.iter().enumerate() {
        if base + size as u64 <= offset {
            base += size as u64;
            continue;
        }
        let chunk = read_chunk(directory, manifest, index)?;
        let mut local = offset.saturating_sub(base) as usize;
        if content.is_empty() {
            while !chunk.is_char_boundary(local) {
                local -= 1;
            }
            start = base + local as u64;
        }
        let mut end = (local + limit.saturating_sub(content.len())).min(chunk.len());
        while !chunk.is_char_boundary(end) {
            end -= 1;
        }
        content.push_str(&chunk[local..end]);
        if end < chunk.len() || content.len() >= limit {
            break;
        }
        base += size as u64;
    }
    Ok((start, content))
}

pub(super) fn read(
    app_data: &Path,
    conversation_id: &str,
    id: &str,
    offset: u64,
    limit: usize,
) -> AppResult<ReadPage> {
    if limit == 0 || limit > MAX_READ_BYTES {
        return Err(AppError::invalid_input("每次读取范围须为 1–12000 字节"));
    }
    let (directory, manifest) = load(app_data, id)?;
    manifest.can_read(conversation_id, false)?;
    // At least one complete UTF-8 scalar must fit so every nonempty page advances.
    let (offset, content) = window(&directory, &manifest, offset, limit.max(4))?;
    let end_offset = offset + content.len() as u64;
    Ok(ReadPage {
        id: manifest.id,
        name: manifest.name,
        offset,
        end_offset,
        next_offset: (end_offset < manifest.size).then_some(end_offset),
        total_bytes: manifest.size,
        content,
    })
}

pub(super) fn search(
    app_data: &Path,
    conversation_id: &str,
    id: &str,
    query: &str,
    offset: u64,
    limit: usize,
) -> AppResult<SearchPage> {
    search_with_scan_limit(
        app_data,
        conversation_id,
        id,
        query,
        offset,
        limit,
        MAX_SEARCH_SCAN_BYTES,
    )
}

fn search_with_scan_limit(
    app_data: &Path,
    conversation_id: &str,
    id: &str,
    query: &str,
    offset: u64,
    limit: usize,
    scan_limit: usize,
) -> AppResult<SearchPage> {
    if query.is_empty() || query.len() > MAX_QUERY_BYTES || limit == 0 || limit > 100 {
        return Err(AppError::invalid_input(
            "搜索文本须为 1–1024 字节，每页结果数须为 1–100",
        ));
    }
    let (directory, manifest) = load(app_data, id)?;
    manifest.can_read(conversation_id, false)?;
    let match_limit = limit.min(MAX_READ_BYTES / query.len());
    let mut matches = Vec::new();
    if offset > manifest.size {
        return Err(AppError::invalid_input("读取位置超过附件大小"));
    }
    let mut next = offset;
    let mut scanned_total = 0;
    // Scan up to 64 MiB per call in bounded windows, so a 1 GB file requires at
    // most 16 scan pages without loading the whole file into memory. Lookahead
    // preserves matches across both scan-window and encrypted-chunk boundaries.
    'windows: while next < manifest.size && scanned_total < scan_limit {
        let budget = MAX_SEARCH_BYTES.min((scan_limit - scanned_total).max(4));
        let (start, content) = window(&directory, &manifest, next, budget + query.len() + 4)?;
        let mut scanned = budget.min(content.len());
        while !content.is_char_boundary(scanned) {
            scanned -= 1;
        }
        let mut cursor = 0;
        while let Some(found) = content[cursor..].find(query) {
            let found = cursor + found;
            if found >= scanned {
                break;
            }
            matches.push(SearchMatch {
                offset: start + found as u64,
                end_offset: start + found as u64 + query.len() as u64,
                text: query.to_owned(),
            });
            // Advance one scalar to preserve overlapping matches across pages.
            cursor = found + content[found..].chars().next().unwrap().len_utf8();
            if matches.len() == match_limit {
                next = start + cursor as u64;
                break 'windows;
            }
        }
        scanned_total += scanned;
        next = start + scanned as u64;
    }
    Ok(SearchPage {
        id: manifest.id,
        name: manifest.name,
        matches,
        next_offset: (next < manifest.size).then_some(next),
        total_bytes: manifest.size,
    })
}

fn for_each_manifest(
    app_data: &Path,
    mut visit: impl FnMut(&Path, Manifest) -> AppResult<()>,
) -> AppResult<()> {
    let storage = root(app_data, false)?;
    if !storage.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&storage)? {
        let entry = entry?;
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if valid_id(&id).is_err() || is_link(&entry.metadata()?) || !entry.file_type()?.is_dir() {
            continue;
        }
        let directory = entry.path();
        // A crash during begin can leave an unpublished directory. It has no
        // reference and cannot be attributed to any conversation.
        if !directory.join("manifest.bin").exists() {
            continue;
        }
        // An unreadable manifest cannot safely establish ownership. Keep that
        // directory untouched without blocking unrelated chats' listing/deletion.
        let Ok(manifest) = read_manifest(&directory, &id) else {
            continue;
        };
        visit(&directory, manifest)?;
    }
    Ok(())
}

fn cleanup_unbound(app_data: &Path, now: SystemTime) -> AppResult<()> {
    let storage = root(app_data, false)?;
    for_each_manifest(app_data, |directory, manifest| {
        if manifest.conversation_id.is_none() {
            let stale = fs::metadata(directory.join("manifest.bin"))
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| now.duration_since(modified).ok())
                .is_some_and(|age| age > DRAFT_RETENTION);
            if stale {
                let _ = remove_directory(&storage, directory);
            }
        }
        Ok(())
    })
}

pub(super) fn list(app_data: &Path, conversation_id: &str) -> AppResult<Vec<AttachmentRef>> {
    valid_id(conversation_id)?;
    let mut result = Vec::new();
    for_each_manifest(app_data, |_, manifest| {
        if manifest.finished && manifest.conversation_id.as_deref() == Some(conversation_id) {
            result.push(manifest.reference());
        }
        Ok(())
    })?;
    result.sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));
    Ok(result)
}

pub(super) fn remove_conversation(app_data: &Path, conversation_id: &str) -> AppResult<()> {
    valid_id(conversation_id)?;
    let storage = root(app_data, false)?;
    for_each_manifest(app_data, |directory, manifest| {
        if manifest.conversation_id.as_deref() == Some(conversation_id) {
            remove_directory(&storage, directory)?;
        }
        Ok(())
    })
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    struct Temporary(PathBuf);
    impl Temporary {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("miraihub-attachment-test-{}", new_id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temporary {
        fn drop(&mut self) {
            let canonical = fs::canonicalize(&self.0).unwrap();
            let temporary = fs::canonicalize(std::env::temp_dir()).unwrap();
            assert_eq!(canonical.parent(), Some(temporary.as_path()));
            assert!(self
                .0
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("miraihub-attachment-test-"));
            let _ = fs::remove_dir_all(canonical);
        }
    }
    const OWNER: &str = "11111111111111111111111111111111";
    const OTHER: &str = "22222222222222222222222222222222";

    #[test]
    fn chunk_sequence_finish_and_encryption_are_durable() {
        let dir = Temporary::new();
        let id = begin(&dir.0, "日志.txt").unwrap();
        assert!(append(&dir.0, &id, 1, "wrong").is_err());
        append(&dir.0, &id, 0, "secret 第一块").unwrap();
        assert!(append(&dir.0, &id, 0, "duplicate").is_err());
        assert!(inspect(&dir.0, OWNER, &id).is_err());
        append(&dir.0, &id, 1, "\n第二块").unwrap();
        let reference = finish(&dir.0, &id).unwrap();
        assert_eq!(reference.size, "secret 第一块\n第二块".len() as u64);
        assert!(append(&dir.0, &id, 2, "late").is_err());
        let chunk = fs::read(chunk_path(&attachment_directory(&dir.0, &id).unwrap(), 0)).unwrap();
        assert!(!chunk.windows(6).any(|part| part == b"secret"));
        assert!(read(&dir.0, OWNER, &id, 0, 100).is_err());
        bind(&dir.0, OWNER, &[id.clone()]).unwrap();
        assert_eq!(
            read(&dir.0, OWNER, &id, 0, 100).unwrap().content,
            "secret 第一块\n第二块"
        );
        assert!(discard(&dir.0, &id).is_err());
    }

    #[test]
    fn reading_adjusts_utf8_offsets_and_pages_without_omissions() {
        let dir = Temporary::new();
        let id = begin(&dir.0, "unicode.txt").unwrap();
        append(&dir.0, &id, 0, "a中文").unwrap();
        append(&dir.0, &id, 1, "😀suffix").unwrap();
        finish(&dir.0, &id).unwrap();
        bind(&dir.0, OWNER, &[id.clone()]).unwrap();
        let page = read(&dir.0, OWNER, &id, 2, 4).unwrap();
        assert_eq!(
            (page.offset, page.content.as_str(), page.next_offset),
            (1, "中", Some(4))
        );
        let mut offset = 0;
        let mut text = String::new();
        loop {
            let page = read(&dir.0, OWNER, &id, offset, 1).unwrap();
            assert!(page.end_offset > offset);
            text.push_str(&page.content);
            let Some(next) = page.next_offset else {
                break;
            };
            offset = next;
        }
        assert_eq!(text, "a中文😀suffix");
        assert!(read(&dir.0, OWNER, &id, 999, 100).is_err());
        assert!(read(&dir.0, OWNER, &id, 0, MAX_READ_BYTES + 1).is_err());
    }

    #[test]
    fn search_crosses_chunks_and_preserves_overlapping_matches_across_pages() {
        let dir = Temporary::new();
        let id = begin(&dir.0, "search.txt").unwrap();
        append(&dir.0, &id, 0, "begin nee").unwrap();
        append(&dir.0, &id, 1, "dle banana needle").unwrap();
        finish(&dir.0, &id).unwrap();
        bind(&dir.0, OWNER, &[id.clone()]).unwrap();
        let page = search(&dir.0, OWNER, &id, "needle", 0, 1).unwrap();
        assert_eq!(page.matches[0].offset, 6);
        let next = search(&dir.0, OWNER, &id, "needle", page.next_offset.unwrap(), 1).unwrap();
        assert_eq!(next.matches[0].offset, 20);
        let page = search(&dir.0, OWNER, &id, "ana", 0, 1).unwrap();
        let next = search(&dir.0, OWNER, &id, "ana", page.next_offset.unwrap(), 1).unwrap();
        assert_eq!(next.matches[0].offset, page.matches[0].offset + 2);
    }

    #[test]
    fn search_scan_limit_returns_a_continuation_even_without_matches() {
        let dir = Temporary::new();
        let content = format!("{}needle", "a".repeat(MAX_SEARCH_BYTES + 5));
        let file = store_text(&dir.0, "large.txt", &content).unwrap();
        bind(&dir.0, OWNER, &[file.id.clone()]).unwrap();
        let page =
            search_with_scan_limit(&dir.0, OWNER, &file.id, "needle", 0, 20, MAX_SEARCH_BYTES)
                .unwrap();
        assert!(page.matches.is_empty());
        let page = search(
            &dir.0,
            OWNER,
            &file.id,
            "needle",
            page.next_offset.unwrap(),
            20,
        )
        .unwrap();
        assert_eq!(page.matches[0].offset, MAX_SEARCH_BYTES as u64 + 5);
        assert_eq!(page.next_offset, None);
        assert_eq!(
            search(&dir.0, OWNER, &file.id, "needle", 0, 20)
                .unwrap()
                .matches[0]
                .offset,
            MAX_SEARCH_BYTES as u64 + 5
        );
        assert_eq!(
            search(&dir.0, OWNER, &file.id, "aaaaaaaaneedle", 0, 20)
                .unwrap()
                .matches[0]
                .offset,
            MAX_SEARCH_BYTES as u64 - 3
        );
    }

    #[test]
    fn binding_is_session_scoped_and_cleanup_keeps_other_owners_and_drafts() {
        let dir = Temporary::new();
        let first = store_text(&dir.0, "first.txt", "first").unwrap();
        let second = store_text(&dir.0, "second.txt", "second").unwrap();
        let draft = store_text(&dir.0, "draft.txt", "draft").unwrap();
        bind(&dir.0, OWNER, &[first.id.clone()]).unwrap();
        assert!(bind(&dir.0, OTHER, &[second.id.clone(), first.id.clone()]).is_err());
        assert_eq!(inspect(&dir.0, OWNER, &second.id).unwrap(), second);
        bind(&dir.0, OTHER, &[second.id.clone()]).unwrap();
        assert!(inspect(&dir.0, OTHER, &first.id).is_err());
        assert!(read(&dir.0, OTHER, &first.id, 0, 100).is_err());
        assert!(search(&dir.0, OTHER, &first.id, "first", 0, 10).is_err());
        assert_eq!(list(&dir.0, OWNER).unwrap(), vec![first]);
        remove_conversation(&dir.0, OWNER).unwrap();
        assert!(list(&dir.0, OWNER).unwrap().is_empty());
        assert_eq!(list(&dir.0, OTHER).unwrap(), vec![second]);
        discard(&dir.0, &draft.id).unwrap();
    }

    #[test]
    fn validates_limits_and_paths_without_allocating_gigabytes() {
        let dir = Temporary::new();
        assert!(begin(&dir.0, "../bad").is_err());
        assert!(finish(&dir.0, "../../escape").is_err());
        let id = begin(&dir.0, "limits.txt").unwrap();
        assert!(append(&dir.0, &id, 0, &"x".repeat(MAX_CHUNK_BYTES + 1)).is_err());
        assert!(append(&dir.0, &id, 0, "binary\0").is_err());
        assert!(finish(&dir.0, &id).is_err());
        append(&dir.0, &id, 0, "x").unwrap();
        finish(&dir.0, &id).unwrap();
        assert!(bind(&dir.0, OWNER, &vec![id.clone(); MAX_FILES + 1]).is_err());
        let (directory, mut manifest) = load(&dir.0, &id).unwrap();
        manifest.chunks = vec![MAX_CHUNK_BYTES; (MAX_FILE_BYTES / MAX_CHUNK_BYTES as u64) as usize];
        let remainder = (MAX_FILE_BYTES % MAX_CHUNK_BYTES as u64) as usize;
        manifest.chunks.push(remainder);
        manifest.size = MAX_FILE_BYTES;
        manifest.finished = false;
        write_manifest(&directory, &manifest).unwrap();
        assert!(append(&dir.0, &id, manifest.chunks.len(), "overflow").is_err());
        manifest.finished = true;
        write_manifest(&directory, &manifest).unwrap();
        let small = store_text(&dir.0, "small.txt", "x").unwrap();
        assert!(bind(&dir.0, OWNER, &[id.clone(), small.id]).is_err());
        assert!(load(&dir.0, &id).unwrap().1.conversation_id.is_none());
    }

    #[test]
    fn cleanup_expires_unbound_drafts_and_preserves_unreadable_or_owned_files() {
        let dir = Temporary::new();
        let draft = store_text(&dir.0, "draft.txt", "draft").unwrap();
        let owned = store_text(&dir.0, "owned.txt", "owned").unwrap();
        bind(&dir.0, OWNER, &[owned.id.clone()]).unwrap();
        let broken = begin(&dir.0, "broken.txt").unwrap();
        let broken_dir = attachment_directory(&dir.0, &broken).unwrap();
        fs::write(broken_dir.join("manifest.bin"), b"invalid ciphertext").unwrap();
        assert_eq!(list(&dir.0, OWNER).unwrap(), vec![owned.clone()]);
        cleanup_unbound(&dir.0, SystemTime::now()).unwrap();
        assert!(inspect(&dir.0, OWNER, &draft.id).is_ok());
        cleanup_unbound(
            &dir.0,
            SystemTime::now() + DRAFT_RETENTION + Duration::from_secs(1),
        )
        .unwrap();
        assert!(inspect(&dir.0, OWNER, &draft.id).is_err());
        assert!(broken_dir.exists());
        assert_eq!(list(&dir.0, OWNER).unwrap(), vec![owned]);
        remove_conversation(&dir.0, OWNER).unwrap();
        assert!(broken_dir.exists());
    }
}
