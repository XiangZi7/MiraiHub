//! 文件剪贴板在发送时冻结文件句柄，接收时先写入临时目录再交给系统剪贴板。
use std::{
    collections::HashSet,
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use ironrdp::cliprdr::{
    is_windows_device_name,
    pdu::{
        ClipboardFileAttributes, FileContentsFlags, FileContentsRequest, FileContentsResponse,
        FileDescriptor,
    },
};
use tempfile::TempDir;
use tokio::io::AsyncWriteExt;

const MAX_FILES: usize = 128;
const MAX_BYTES: u64 = 1024 * 1024 * 1024;
const CHUNK_BYTES: u64 = 512 * 1024;
const MAX_REQUEST_BYTES: u32 = 4 * 1024 * 1024;
const FILE_TIMEOUT: Duration = Duration::from_secs(20);

/// 只接受 Windows 可安全粘贴的单层文件名，禁止路径、设备名和替代数据流。
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.encode_utf16().count() < 260
        && !name.ends_with(['.', ' '])
        && !name.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|'])
        && !name.chars().any(char::is_control)
        && !is_windows_device_name(name)
}

pub(super) struct LocalFile {
    pub(super) descriptor: FileDescriptor,
    file: Mutex<File>,
}

pub(super) type LocalFiles = Arc<Vec<LocalFile>>;

/// 将系统剪贴板中的文件变成不可被后续剪贴板操作替换的文件快照。
pub(super) fn snapshot(paths: Vec<PathBuf>) -> io::Result<LocalFiles> {
    if paths.is_empty() || paths.len() > MAX_FILES {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let mut names = HashSet::new();
    let mut total = 0;
    let mut files = Vec::with_capacity(paths.len());
    for path in paths {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| valid_name(name) && names.insert(name.to_lowercase()))
            .ok_or(io::ErrorKind::InvalidData)?;
        if !path.is_absolute() || !path.symlink_metadata()?.is_file() {
            return Err(io::ErrorKind::InvalidData.into());
        }
        let file = File::open(&path)?;
        let size = file.metadata()?.len();
        total = add_size(total, size)?;
        files.push(LocalFile {
            descriptor: FileDescriptor::new(name)
                .with_attributes(ClipboardFileAttributes::NORMAL)
                .with_file_size(size),
            file: Mutex::new(file),
        });
    }
    Ok(Arc::new(files))
}

fn add_size(total: u64, size: u64) -> io::Result<u64> {
    total
        .checked_add(size)
        .filter(|size| *size <= MAX_BYTES)
        .ok_or_else(|| io::ErrorKind::InvalidData.into())
}

/// 按协议读取已经明确分享的文件区间，请求失败时返回对应 streamId 的错误。
pub(super) fn read_range(
    files: Option<LocalFiles>,
    request: FileContentsRequest,
) -> FileContentsResponse<'static> {
    let request_id = request.stream_id;
    let read = || {
        let files = files?;
        let entry = files.get(usize::try_from(request.index).ok()?)?;
        let size = entry.descriptor.file_size?;
        match request.flags {
            FileContentsFlags::SIZE => {
                Some(FileContentsResponse::new_size_response(request_id, size))
            }
            FileContentsFlags::RANGE if request.requested_size <= MAX_REQUEST_BYTES => {
                let remaining = size.checked_sub(request.position)?;
                let mut bytes = vec![0; remaining.min(u64::from(request.requested_size)) as usize];
                let mut file = entry.file.lock().ok()?;
                file.seek(SeekFrom::Start(request.position)).ok()?;
                file.read_exact(&mut bytes).ok()?;
                Some(FileContentsResponse::new_data_response(request_id, bytes))
            }
            _ => None,
        }
    };
    read().unwrap_or_else(|| FileContentsResponse::new_error(request_id))
}

struct DownloadFile {
    path: PathBuf,
    size: Option<u64>,
}

pub(super) struct IncomingFiles {
    files: Vec<DownloadFile>,
    current: usize,
    offset: u64,
    total: u64,
    output: Option<tokio::fs::File>,
    waiting: Option<(FileContentsRequest, Instant)>,
    data_id: Option<u32>,
    revision: Option<u32>,
    directory: TempDir,
}

impl IncomingFiles {
    /// 验证整批描述符后再分配临时目录，保留服务器的文件索引顺序。
    pub(super) fn new(
        files: Vec<FileDescriptor>,
        data_id: Option<u32>,
        revision: Option<u32>,
    ) -> io::Result<Self> {
        if files.is_empty() || files.len() > MAX_FILES {
            return Err(io::ErrorKind::InvalidData.into());
        }
        let mut names = HashSet::new();
        let mut total = 0;
        for file in &files {
            if file.relative_path.is_some()
                || file.attributes.is_some_and(|attributes| {
                    attributes.contains(ClipboardFileAttributes::DIRECTORY)
                })
                || !valid_name(&file.name)
                || !names.insert(file.name.to_lowercase())
            {
                return Err(io::ErrorKind::InvalidData.into());
            }
            total = add_size(total, file.file_size.unwrap_or_default())?;
        }
        let directory = tempfile::Builder::new()
            .prefix("miraihub-rdp-clipboard-")
            .tempdir()?;
        let files = files
            .into_iter()
            .map(|file| DownloadFile {
                path: directory.path().join(file.name),
                size: file.file_size,
            })
            .collect();
        Ok(Self {
            directory,
            files,
            current: 0,
            offset: 0,
            total,
            output: None,
            waiting: None,
            data_id,
            revision,
        })
    }

    /// 只保持一个未完成的请求，逐块写盘并处理空文件。
    pub(super) async fn request(
        &mut self,
        stream_id: u32,
    ) -> io::Result<Option<FileContentsRequest>> {
        if let Some((_, deadline)) = self.waiting {
            return if Instant::now() > deadline {
                Err(io::ErrorKind::TimedOut.into())
            } else {
                Ok(None)
            };
        }
        while let Some(file) = self.files.get(self.current) {
            let (flags, requested_size) = match file.size {
                None => (FileContentsFlags::SIZE, 8),
                Some(size) => {
                    if self.output.is_none() {
                        self.output = Some(
                            tokio::fs::File::options()
                                .write(true)
                                .create_new(true)
                                .open(&file.path)
                                .await?,
                        );
                    }
                    if size == self.offset {
                        if let Some(mut output) = self.output.take() {
                            output.flush().await?;
                        }
                        self.current += 1;
                        self.offset = 0;
                        continue;
                    }
                    (
                        FileContentsFlags::RANGE,
                        (size - self.offset).min(CHUNK_BYTES) as u32,
                    )
                }
            };
            let request = FileContentsRequest {
                stream_id,
                index: self.current as i32,
                flags,
                position: self.offset,
                requested_size,
                data_id: self.data_id,
            };
            self.waiting = Some((request.clone(), Instant::now() + FILE_TIMEOUT));
            return Ok(Some(request));
        }
        Ok(None)
    }

    /// 校验 streamId 与返回长度，避免将失败或截断文件发布到剪贴板。
    pub(super) async fn receive(
        &mut self,
        response: FileContentsResponse<'static>,
    ) -> io::Result<()> {
        let Some((request, _)) = self.waiting.as_ref() else {
            return Ok(());
        };
        if request.stream_id != response.stream_id() {
            return Ok(());
        }
        if response.is_error() {
            return Err(io::ErrorKind::InvalidData.into());
        }
        if request.flags == FileContentsFlags::SIZE {
            let size = response
                .data_as_size()
                .map_err(|_| io::ErrorKind::InvalidData)?;
            self.total = add_size(self.total, size)?;
            self.files[self.current].size = Some(size);
        } else {
            let bytes = response.data();
            if bytes.is_empty() || bytes.len() > request.requested_size as usize {
                return Err(io::ErrorKind::InvalidData.into());
            }
            self.output
                .as_mut()
                .ok_or(io::ErrorKind::InvalidData)?
                .write_all(bytes)
                .await?;
            self.offset += bytes.len() as u64;
        }
        self.waiting = None;
        Ok(())
    }

    pub(super) fn complete(&self) -> bool {
        self.current == self.files.len()
    }

    pub(super) fn is_small(&self) -> bool {
        self.total < CHUNK_BYTES && self.files.iter().all(|file| file.size.is_some())
    }

    /// 当前选择被用户替换时保留更新的系统剪贴板，取消仍在读取的旧文件。
    pub(super) fn is_current(&self) -> bool {
        self.revision.is_none() || self.revision == revision()
    }

    /// Explorer 粘贴读取的是实际文件路径，临时副本需在 RDP 会话结束后继续存活。
    pub(super) fn publish(self) -> Option<bool> {
        static LAST_FILES: Mutex<Option<TempDir>> = Mutex::new(None);
        let mut last_files = LAST_FILES.lock().unwrap_or_else(|error| error.into_inner());
        if !self.is_current() {
            return None;
        }
        let paths: Vec<&Path> = self.files.iter().map(|file| file.path.as_path()).collect();
        let copied =
            super::system_clipboard(|clipboard| clipboard.set().file_list(&paths)).is_some();
        if copied {
            let previous = last_files.replace(self.directory);
            if let Some(previous) = previous {
                // 给已经发起的本地粘贴保留读取时间。
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(300)).await;
                    drop(previous);
                });
            }
        }
        Some(copied)
    }
}

pub(super) fn revision() -> Option<u32> {
    #[cfg(windows)]
    {
        let sequence =
            unsafe { windows::Win32::System::DataExchange::GetClipboardSequenceNumber() };
        (sequence != 0).then_some(sequence)
    }
    #[cfg(not(windows))]
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_bytes_only_from_the_explicit_local_file_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("测试.txt");
        std::fs::write(&path, b"abcdef").unwrap();
        let files = snapshot(vec![path]).unwrap();
        assert_eq!(files[0].descriptor.name, "测试.txt");
        let mut request = FileContentsRequest {
            stream_id: 12,
            index: 0,
            flags: FileContentsFlags::SIZE,
            position: 0,
            requested_size: 8,
            data_id: Some(6),
        };
        let response = read_range(Some(files.clone()), request.clone());
        assert_eq!(response.stream_id(), 12);
        assert_eq!(response.data_as_size().unwrap(), 6);
        request.flags = FileContentsFlags::RANGE;
        request.position = 2;
        request.requested_size = 3;
        assert_eq!(
            read_range(Some(files.clone()), request.clone()).data(),
            b"cde"
        );
        assert!(read_range(None, request.clone()).is_error());
        request.index = 1;
        assert!(read_range(Some(files), request).is_error());
    }

    #[tokio::test]
    async fn stages_remote_files_in_order_and_verifies_the_received_contents() {
        let mut copy = IncomingFiles::new(
            vec![
                FileDescriptor::new("app-ads.txt"),
                FileDescriptor::new("empty.txt").with_file_size(0),
            ],
            Some(9),
            None,
        )
        .unwrap();
        let size = copy.request(1).await.unwrap().unwrap();
        assert_eq!(size.flags, FileContentsFlags::SIZE);
        assert_eq!(size.data_id, Some(9));
        copy.receive(FileContentsResponse::new_size_response(1, 8))
            .await
            .unwrap();
        let first = copy.request(2).await.unwrap().unwrap();
        assert_eq!(first.requested_size, 8);
        copy.receive(FileContentsResponse::new_data_response(2, &b"abcd"[..]))
            .await
            .unwrap();
        let last = copy.request(3).await.unwrap().unwrap();
        assert_eq!((last.position, last.requested_size), (4, 4));
        copy.receive(FileContentsResponse::new_data_response(3, &b"efgh"[..]))
            .await
            .unwrap();
        assert!(copy.request(4).await.unwrap().is_none());
        assert!(copy.complete());
        assert_eq!(std::fs::read(&copy.files[0].path).unwrap(), b"abcdefgh");
        assert_eq!(std::fs::read(&copy.files[1].path).unwrap(), b"");
    }

    #[test]
    fn rejects_unsafe_or_duplicate_file_descriptors_before_opening_outputs() {
        for path in [
            "../test",
            r"..\test",
            "file.txt:stream",
            "COM1.txt",
            "example.",
        ] {
            assert!(IncomingFiles::new(vec![FileDescriptor::new(path)], None, None).is_err());
        }
        assert!(IncomingFiles::new(
            vec![FileDescriptor::new("Readme"), FileDescriptor::new("README")],
            None,
            None,
        )
        .is_err());
        assert!(IncomingFiles::new(
            vec![FileDescriptor::new("large").with_file_size(MAX_BYTES + 1)],
            None,
            None,
        )
        .is_err());
    }
}
