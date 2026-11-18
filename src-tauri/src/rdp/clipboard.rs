//! 只有当前会话的显式复制粘贴会触发 RDP 文本或文件传输。
mod files;

use std::{
    collections::HashMap,
    fmt,
    sync::Mutex,
    time::{Duration, Instant},
};

use ironrdp::{
    cliprdr::{
        backend::CliprdrBackend,
        pdu::{
            ClipboardFormat, ClipboardFormatId, ClipboardFormatName,
            ClipboardGeneralCapabilityFlags, FileContentsRequest, FileContentsResponse,
            FileDescriptor, FormatDataRequest, FormatDataResponse, LockDataId,
            OwnedFormatDataResponse,
        },
        CliprdrClient,
    },
    core::IntoOwned as _,
    session::ActiveStage,
};

use self::files::{IncomingFiles, LocalFiles};

const UNICODE_TEXT: ClipboardFormatId = ClipboardFormatId::CF_UNICODETEXT;
const MAX_TEXT_BYTES: usize = 1024 * 1024;
const CLIPBOARD_TIMEOUT: Duration = Duration::from_secs(3);
const COPY_ERROR: &str = "无法复制远程桌面文件";
const PASTE_ERROR: &str = "无法将本机文件粘贴到远程桌面";

#[derive(Default)]
pub(super) struct SessionClipboard {
    initialize: bool,
    ready: bool,
    copy_until: Option<(Instant, Option<u32>)>,
    request_format: Option<(ClipboardFormatId, Option<u32>)>,
    awaiting_format: Option<(ClipboardFormatId, Option<u32>, Instant)>,
    incoming_text: Option<String>,
    local_text: Option<String>,
    response: Option<OwnedFormatDataResponse>,
    paste_until: Option<Instant>,
    list_response: Option<bool>,
    local_files: Option<LocalFiles>,
    locked_files: HashMap<u32, LocalFiles>,
    file_request: Option<(FileContentsRequest, Option<LocalFiles>)>,
    file_response: Option<FileContentsResponse<'static>>,
    file_list: Option<(Vec<FileDescriptor>, Option<u32>, Option<u32>)>,
    download: Option<IncomingFiles>,
    stream_id: u32,
    file_notice: Option<(&'static str, bool)>,
}

ironrdp::core::impl_as_any!(SessionClipboard);

impl fmt::Debug for SessionClipboard {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RdpClipboard")
            .finish_non_exhaustive()
    }
}

impl CliprdrBackend for SessionClipboard {
    fn temporary_directory(&self) -> &str {
        ""
    }

    fn client_capabilities(&self) -> ClipboardGeneralCapabilityFlags {
        ClipboardGeneralCapabilityFlags::USE_LONG_FORMAT_NAMES
            | ClipboardGeneralCapabilityFlags::STREAM_FILECLIP_ENABLED
            | ClipboardGeneralCapabilityFlags::FILECLIP_NO_FILE_PATHS
            | ClipboardGeneralCapabilityFlags::CAN_LOCK_CLIPDATA
    }

    fn on_ready(&mut self) {
        self.ready = true;
    }

    fn on_request_format_list(&mut self) {
        self.initialize = true;
    }

    fn on_format_list_response(&mut self, ok: bool) {
        if self.paste_until.is_some() {
            self.list_response = Some(ok);
        }
    }

    fn on_process_negotiated_capabilities(&mut self, _: ClipboardGeneralCapabilityFlags) {}

    fn on_remote_copy(&mut self, formats: &[ClipboardFormat]) {
        if self.paste_until.is_none() {
            self.local_text = None;
            self.local_files = None;
        }
        if let Some((_, revision)) = self
            .copy_until
            .filter(|(deadline, _)| Instant::now() <= *deadline)
        {
            let format = formats
                .iter()
                .find(|format| format.name() == Some(&ClipboardFormatName::FILE_LIST))
                .or_else(|| formats.iter().find(|format| format.id() == UNICODE_TEXT));
            let Some(format) = format else {
                return;
            };
            self.request_format = Some((format.id(), revision));
            self.copy_until = None;
        }
    }

    fn on_format_data_request(&mut self, request: FormatDataRequest) {
        self.response = Some(match &self.local_text {
            Some(text) if request.format == UNICODE_TEXT => {
                FormatDataResponse::new_unicode_string(text)
            }
            _ => FormatDataResponse::new_error(),
        });
    }

    fn on_format_data_response(&mut self, response: FormatDataResponse<'_>) {
        let Some((format, _, _)) = self.awaiting_format.take() else {
            return;
        };
        if format == UNICODE_TEXT && !response.is_error() && response.data().len() <= MAX_TEXT_BYTES
        {
            self.incoming_text = response.to_unicode_string().ok();
        } else if format != UNICODE_TEXT {
            self.file_notice = Some((COPY_ERROR, true));
        }
    }

    fn on_remote_file_list(&mut self, files: &[FileDescriptor], data_id: Option<u32>) {
        if let Some((_, revision, _)) = self
            .awaiting_format
            .take()
            .filter(|(format, _, _)| *format != UNICODE_TEXT)
        {
            self.file_list = Some((files.to_vec(), data_id, revision));
        }
    }

    fn on_file_contents_request(&mut self, request: FileContentsRequest) {
        let snapshot = match request.data_id {
            Some(id) => self.locked_files.get(&id),
            None => self.local_files.as_ref(),
        };
        self.file_request = Some((request, snapshot.cloned()));
    }

    fn on_file_contents_response(&mut self, response: FileContentsResponse<'_>) {
        self.file_response = Some(response.into_owned());
    }

    fn on_lock(&mut self, id: LockDataId) {
        if let Some(files) = self
            .local_files
            .as_ref()
            .filter(|_| self.locked_files.len() < 16)
        {
            self.locked_files.insert(id.0, files.clone());
        }
    }

    fn on_unlock(&mut self, id: LockDataId) {
        self.locked_files.remove(&id.0);
    }
}

/// 保持系统剪贴板句柄存活，兼容由客户端持有粘贴内容的系统。
fn system_clipboard<T>(
    action: impl FnOnce(&mut arboard::Clipboard) -> Result<T, arboard::Error>,
) -> Option<T> {
    static CLIPBOARD: Mutex<Option<arboard::Clipboard>> = Mutex::new(None);
    let mut state = CLIPBOARD.lock().ok()?;
    if state.is_none() {
        *state = arboard::Clipboard::new().ok();
    }
    action(state.as_mut()?).ok()
}

fn backend(stage: &mut ActiveStage) -> Option<&mut SessionClipboard> {
    stage
        .get_svc_processor_mut::<CliprdrClient>()?
        .downcast_backend_mut()
}

pub(super) fn begin_copy(stage: &mut ActiveStage) {
    if let Some(clipboard) = backend(stage) {
        clipboard.copy_until = Some((Instant::now() + CLIPBOARD_TIMEOUT, files::revision()));
    }
}

/// 读取点下 Ctrl+V 时的系统剪贴板，优先使用资源管理器中的文件列表。
enum LocalContent {
    Text(String),
    Files(std::io::Result<LocalFiles>),
}

fn local_content() -> Option<LocalContent> {
    let files = system_clipboard(|clipboard| clipboard.get().file_list());
    if let Some(paths) = files.filter(|paths| !paths.is_empty()) {
        return Some(LocalContent::Files(files::snapshot(paths)));
    }
    let text = system_clipboard(|clipboard| clipboard.get_text())?;
    if text.is_empty() || text.contains('\0') || text.len() > MAX_TEXT_BYTES {
        return None;
    }
    let text = text.replace("\r\n", "\n").replace('\n', "\r\n");
    (text.encode_utf16().count() < MAX_TEXT_BYTES / 2).then_some(LocalContent::Text(text))
}

pub(super) enum Paste {
    Forward,
    Wait(Vec<u8>),
    Skip,
}

/// 先发布本机内容，等服务端接收格式列表后再送出 Ctrl+V。
pub(super) async fn begin_paste(stage: &mut ActiveStage) -> Paste {
    let Some(clipboard) = backend(stage) else {
        return Paste::Forward;
    };
    if clipboard.paste_until.is_some() {
        return Paste::Skip;
    }
    let Ok(Some(content)) = tokio::task::spawn_blocking(local_content).await else {
        return Paste::Forward;
    };
    if !clipboard.ready {
        if matches!(content, LocalContent::Files(_)) {
            clipboard.file_notice = Some((PASTE_ERROR, true));
            return Paste::Skip;
        }
        return Paste::Forward;
    }
    let channel = stage
        .get_svc_processor_mut::<CliprdrClient>()
        .expect("clipboard channel attached");
    let messages = match &content {
        LocalContent::Text(_) => channel
            .initiate_copy(&[ClipboardFormat::new(UNICODE_TEXT)])
            .ok(),
        LocalContent::Files(Ok(files)) => channel
            .initiate_file_copy(files.iter().map(|file| file.descriptor.clone()).collect())
            .ok(),
        LocalContent::Files(Err(_)) => None,
    };
    let Some(messages) = messages else {
        clipboard_file_notice(stage, PASTE_ERROR, true);
        return Paste::Skip;
    };
    let Ok(frame) = stage.process_svc_processor_messages(messages) else {
        clipboard_file_notice(stage, PASTE_ERROR, true);
        return Paste::Skip;
    };
    let clipboard = backend(stage).expect("clipboard backend attached");
    clipboard.local_text = None;
    clipboard.local_files = None;
    match content {
        LocalContent::Text(text) => clipboard.local_text = Some(text),
        LocalContent::Files(files) => clipboard.local_files = files.ok(),
    }
    clipboard.paste_until = Some(Instant::now() + CLIPBOARD_TIMEOUT);
    clipboard.list_response = None;
    Paste::Wait(frame)
}

fn clipboard_file_notice(stage: &mut ActiveStage, message: &'static str, error: bool) {
    if let Some(clipboard) = backend(stage) {
        clipboard.file_notice = Some((message, error));
    }
}

/// 推进接收任务，一次只请求一个文件块，结束后才将实际文件放入系统剪贴板。
async fn poll_download(
    clipboard: &mut SessionClipboard,
    notify: &impl Fn(&'static str, bool),
) -> std::io::Result<Option<FileContentsRequest>> {
    if let Some((files, lock, revision)) = clipboard.file_list.take() {
        clipboard.download = None;
        let download = IncomingFiles::new(files, lock, revision)?;
        if download.is_current() {
            if !download.is_small() {
                notify("正在复制远程桌面文件…", false);
            }
            clipboard.download = Some(download);
        }
    }
    let response = clipboard.file_response.take();
    let Some(download) = clipboard.download.as_mut() else {
        return Ok(None);
    };
    if !download.is_current() {
        clipboard.download = None;
        return Ok(None);
    }
    if let Some(response) = response {
        download.receive(response).await?;
    }
    let next = clipboard.stream_id.wrapping_add(1);
    let request = download.request(next).await?;
    if request.is_some() {
        clipboard.stream_id = next;
    }
    if download.complete() {
        let download = clipboard
            .download
            .take()
            .expect("completed clipboard download");
        if let Some(copied) = tokio::task::spawn_blocking(move || download.publish())
            .await
            .ok()
            .flatten()
        {
            notify(
                if copied {
                    "已复制远程桌面文件"
                } else {
                    COPY_ERROR
                },
                !copied,
            );
        }
    }
    Ok(request)
}

/// 将频道回调里的操作转换成网络帧，在格式公告结束时触发远端粘贴。
pub(super) async fn poll(
    stage: &mut ActiveStage,
    notify: impl Fn(&'static str, bool),
) -> (Vec<Vec<u8>>, bool) {
    let Some(clipboard) = backend(stage) else {
        return (Vec::new(), false);
    };
    if let Some((message, error)) = clipboard.file_notice.take() {
        notify(message, error);
    }
    let download_request = match poll_download(clipboard, &notify).await {
        Ok(request) => request,
        Err(_) => {
            clipboard.download = None;
            notify(COPY_ERROR, true);
            None
        }
    };
    let file_response = if let Some((request, snapshot)) = clipboard.file_request.take() {
        let stream_id = request.stream_id;
        Some(
            tokio::task::spawn_blocking(move || files::read_range(snapshot, request))
                .await
                .unwrap_or_else(|_| FileContentsResponse::new_error(stream_id)),
        )
    } else {
        None
    };
    let start = std::mem::take(&mut clipboard.initialize);
    if let Some((format, _, deadline)) = clipboard.awaiting_format {
        if Instant::now() > deadline {
            clipboard.awaiting_format = None;
            if format != UNICODE_TEXT {
                notify(COPY_ERROR, true);
            }
        }
    }
    let request = if clipboard.awaiting_format.is_none() {
        clipboard.request_format.take()
    } else {
        None
    };
    let response = clipboard.response.take();
    let text = clipboard.incoming_text.take();
    let mut paste = clipboard
        .paste_until
        .is_some_and(|deadline| clipboard.list_response.is_some() || Instant::now() > deadline);
    if paste {
        if clipboard.list_response.take() != Some(true) {
            clipboard.local_text = None;
            if clipboard.local_files.take().is_some() {
                paste = false;
                notify(PASTE_ERROR, true);
            }
        }
        clipboard.paste_until = None;
    }
    let channel = stage
        .get_svc_processor_mut::<CliprdrClient>()
        .expect("clipboard channel attached");
    let mut outbound = Vec::new();
    if start {
        if let Ok(messages) = channel.initiate_copy(&[]) {
            outbound.push(messages);
        }
    }
    if let Some((format, revision)) = request {
        if let Ok(messages) = channel.initiate_paste(format) {
            channel
                .downcast_backend_mut::<SessionClipboard>()
                .unwrap()
                .awaiting_format =
                Some((format, revision, Instant::now() + Duration::from_secs(15)));
            outbound.push(messages);
        } else if format != UNICODE_TEXT {
            notify(COPY_ERROR, true);
        }
    }
    if let Some(response) = file_response {
        if let Ok(messages) = channel.submit_file_contents(response) {
            outbound.push(messages);
        }
    }
    if let Some(request) = download_request {
        match channel.request_file_contents(request) {
            Ok(messages) => outbound.push(messages),
            Err(_) => {
                channel
                    .downcast_backend_mut::<SessionClipboard>()
                    .unwrap()
                    .download = None;
                notify(COPY_ERROR, true);
            }
        }
    }
    if let Ok(messages) = channel.drive_timeouts() {
        outbound.push(messages);
    }
    if let Some(response) = response {
        if let Ok(messages) = channel.submit_format_data(response) {
            outbound.push(messages);
        }
    }
    let frames = outbound
        .into_iter()
        .filter_map(|messages| stage.process_svc_processor_messages(messages).ok())
        .filter(|frame| !frame.is_empty())
        .collect();
    if let Some(text) = text {
        let _ = tokio::task::spawn_blocking(move || {
            system_clipboard(|clipboard| clipboard.set_text(text))
        })
        .await;
    }
    (frames, paste)
}

#[cfg(test)]
mod tests {
    use super::*;

    use ironrdp::{
        cliprdr::{Cliprdr, CliprdrServer, Role},
        svc::{SvcMessage, SvcProcessor},
    };

    fn relay(
        messages: impl Into<Vec<SvcMessage>>,
        receiver: &mut impl SvcProcessor,
    ) -> Vec<SvcMessage> {
        messages
            .into()
            .into_iter()
            .flat_map(|message| {
                receiver
                    .process(&message.encode_unframed_pdu().unwrap())
                    .unwrap()
            })
            .collect()
    }

    async fn transfer_file<S: Role, R: Role>(sender: &mut Cliprdr<S>, receiver: &mut Cliprdr<R>) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("剪贴板.txt");
        std::fs::write(&path, b"clipboard payload").unwrap();
        let files = files::snapshot(vec![path]).unwrap();
        sender
            .downcast_backend_mut::<SessionClipboard>()
            .unwrap()
            .local_files = Some(files.clone());
        receiver
            .downcast_backend_mut::<SessionClipboard>()
            .unwrap()
            .copy_until = Some((Instant::now() + CLIPBOARD_TIMEOUT, None));
        let offer = sender
            .initiate_file_copy(vec![files[0].descriptor.clone()])
            .unwrap();
        let accepted = relay(offer, receiver);
        relay(accepted, sender);

        let backend = receiver.downcast_backend_mut::<SessionClipboard>().unwrap();
        let (format, revision) = backend.request_format.take().unwrap();
        backend.awaiting_format = Some((format, revision, Instant::now() + CLIPBOARD_TIMEOUT));
        let descriptor_request = receiver.initiate_paste(format).unwrap();
        let descriptors = relay(descriptor_request, sender);
        relay(descriptors, receiver);
        let (descriptors, lock, revision) = receiver
            .downcast_backend_mut::<SessionClipboard>()
            .unwrap()
            .file_list
            .take()
            .unwrap();
        assert_eq!(descriptors[0].name, "剪贴板.txt");
        let mut incoming = IncomingFiles::new(descriptors, lock, revision).unwrap();

        let request = receiver
            .request_file_contents(incoming.request(1).await.unwrap().unwrap())
            .unwrap();
        relay(request, sender);
        let (request, snapshot) = sender
            .downcast_backend_mut::<SessionClipboard>()
            .unwrap()
            .file_request
            .take()
            .unwrap();
        let chunk = sender
            .submit_file_contents(files::read_range(snapshot, request))
            .unwrap();
        relay(chunk, receiver);
        let response = receiver
            .downcast_backend_mut::<SessionClipboard>()
            .unwrap()
            .file_response
            .take()
            .unwrap();
        assert_eq!(response.data(), b"clipboard payload");
        incoming.receive(response).await.unwrap();
        assert!(incoming.request(2).await.unwrap().is_none());
        assert!(incoming.complete());
    }

    #[tokio::test]
    async fn file_lists_and_chunks_round_trip_through_both_cliprdr_roles() {
        let mut server = CliprdrServer::new(Box::new(SessionClipboard::default()));
        let mut client = CliprdrClient::new(Box::new(SessionClipboard::default()));
        relay(server.start().unwrap(), &mut client);
        let reply = relay(client.initiate_copy(&[]).unwrap(), &mut server);
        relay(reply, &mut client);
        transfer_file(&mut client, &mut server).await;
        transfer_file(&mut server, &mut client).await;
    }

    #[test]
    fn unicode_text_is_exchanged_only_after_a_clipboard_shortcut() {
        let mut clipboard = SessionClipboard::default();
        let formats = [ClipboardFormat::new(UNICODE_TEXT)];
        clipboard.on_remote_copy(&formats);
        assert!(clipboard.request_format.is_none());
        clipboard.copy_until = Some((Instant::now() + CLIPBOARD_TIMEOUT, None));
        clipboard.on_remote_copy(&formats);
        assert_eq!(clipboard.request_format, Some((UNICODE_TEXT, None)));
        let data = FormatDataResponse::new_unicode_string("中文 🌟");
        clipboard.on_format_data_response(data.clone());
        assert_eq!(clipboard.incoming_text, None);
        clipboard.awaiting_format = Some((UNICODE_TEXT, None, Instant::now() + CLIPBOARD_TIMEOUT));
        clipboard.on_format_data_response(data);
        assert_eq!(clipboard.incoming_text.as_deref(), Some("中文 🌟"));

        let request = FormatDataRequest {
            format: UNICODE_TEXT,
        };
        clipboard.on_format_data_request(request.clone());
        assert!(clipboard.response.take().unwrap().is_error());
        clipboard.local_text = Some("本地文字".to_owned());
        clipboard.on_format_data_request(request);
        assert_eq!(
            clipboard
                .response
                .take()
                .unwrap()
                .to_unicode_string()
                .unwrap(),
            "本地文字"
        );
    }
}
