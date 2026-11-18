//! RDP 的 Unicode 文本剪贴板，只在当前会话收到复制或粘贴操作时传递内容。
use std::{
    fmt,
    sync::Mutex,
    time::{Duration, Instant},
};

use ironrdp::{
    cliprdr::{
        backend::CliprdrBackend,
        pdu::{
            ClipboardFormat, ClipboardFormatId, ClipboardGeneralCapabilityFlags,
            FileContentsRequest, FileContentsResponse, FormatDataRequest, FormatDataResponse,
            LockDataId, OwnedFormatDataResponse,
        },
        CliprdrClient,
    },
    session::ActiveStage,
};

const UNICODE_TEXT: ClipboardFormatId = ClipboardFormatId::CF_UNICODETEXT;
const MAX_TEXT_BYTES: usize = 1024 * 1024;
const CLIPBOARD_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Default)]
pub(super) struct TextClipboard {
    initialize: bool,
    ready: bool,
    copy_until: Option<Instant>,
    request_text: bool,
    awaiting_text: bool,
    incoming_text: Option<String>,
    local_text: Option<String>,
    response: Option<OwnedFormatDataResponse>,
    paste_until: Option<Instant>,
    list_response: Option<bool>,
}

ironrdp::core::impl_as_any!(TextClipboard);

impl fmt::Debug for TextClipboard {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RdpTextClipboard")
            .finish_non_exhaustive()
    }
}

impl CliprdrBackend for TextClipboard {
    fn temporary_directory(&self) -> &str {
        ""
    }

    fn client_capabilities(&self) -> ClipboardGeneralCapabilityFlags {
        ClipboardGeneralCapabilityFlags::USE_LONG_FORMAT_NAMES
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
        }
        if self
            .copy_until
            .is_some_and(|deadline| Instant::now() <= deadline)
            && formats.iter().any(|format| format.id() == UNICODE_TEXT)
        {
            self.request_text = true;
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
        if std::mem::take(&mut self.awaiting_text)
            && !response.is_error()
            && response.data().len() <= MAX_TEXT_BYTES
        {
            self.incoming_text = response.to_unicode_string().ok();
        }
    }

    fn on_file_contents_request(&mut self, _: FileContentsRequest) {}
    fn on_file_contents_response(&mut self, _: FileContentsResponse<'_>) {}
    fn on_lock(&mut self, _: LockDataId) {}
    fn on_unlock(&mut self, _: LockDataId) {}
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

fn backend(stage: &mut ActiveStage) -> Option<&mut TextClipboard> {
    stage
        .get_svc_processor_mut::<CliprdrClient>()?
        .downcast_backend_mut()
}

pub(super) fn begin_copy(stage: &mut ActiveStage) {
    if let Some(clipboard) = backend(stage) {
        clipboard.copy_until = Some(Instant::now() + CLIPBOARD_TIMEOUT);
    }
}

/// 先发布本机文字，等待服务端接收格式列表后再送出 Ctrl+V。
pub(super) async fn begin_paste(stage: &mut ActiveStage) -> Option<Vec<u8>> {
    let clipboard = backend(stage)?;
    if !clipboard.ready || clipboard.paste_until.is_some() {
        return None;
    }
    let text = tokio::task::spawn_blocking(|| system_clipboard(|clipboard| clipboard.get_text()))
        .await
        .ok()
        .flatten()?;
    if text.is_empty() || text.contains('\0') || text.len() > MAX_TEXT_BYTES {
        return None;
    }
    let text = text.replace("\r\n", "\n").replace('\n', "\r\n");
    if text.encode_utf16().count() >= MAX_TEXT_BYTES / 2 {
        return None;
    }
    let channel = stage.get_svc_processor_mut::<CliprdrClient>()?;
    let messages = channel
        .initiate_copy(&[ClipboardFormat::new(UNICODE_TEXT)])
        .ok()?;
    let frame = stage.process_svc_processor_messages(messages).ok()?;
    let clipboard = backend(stage)?;
    clipboard.local_text = Some(text);
    clipboard.paste_until = Some(Instant::now() + CLIPBOARD_TIMEOUT);
    clipboard.list_response = None;
    Some(frame)
}

/// 将频道回调里的请求转换成网络响应，并在格式公告结束后触发粘贴。
pub(super) async fn poll(stage: &mut ActiveStage) -> (Vec<Vec<u8>>, bool) {
    let Some(channel) = stage.get_svc_processor_mut::<CliprdrClient>() else {
        return (Vec::new(), false);
    };
    let clipboard = channel
        .downcast_backend_mut::<TextClipboard>()
        .expect("CLIPRDR is attached with the text backend");
    let start = std::mem::take(&mut clipboard.initialize);
    let request = !clipboard.awaiting_text && std::mem::take(&mut clipboard.request_text);
    let response = clipboard.response.take();
    let text = clipboard.incoming_text.take();
    let paste = clipboard
        .paste_until
        .is_some_and(|deadline| clipboard.list_response.is_some() || Instant::now() > deadline);
    if paste {
        if clipboard.list_response.take() != Some(true) {
            clipboard.local_text = None;
        }
        clipboard.paste_until = None;
    }
    let mut outbound = Vec::new();
    if start {
        if let Ok(messages) = channel.initiate_copy(&[]) {
            outbound.push(messages);
        }
    }
    if request {
        if let Ok(messages) = channel.initiate_paste(UNICODE_TEXT) {
            channel
                .downcast_backend_mut::<TextClipboard>()
                .unwrap()
                .awaiting_text = true;
            outbound.push(messages);
        }
    }
    if let Some(response) = response {
        if let Ok(messages) = channel.submit_format_data(response) {
            outbound.push(messages);
        }
    }
    let frames = outbound
        .into_iter()
        .filter_map(|messages| stage.process_svc_processor_messages(messages).ok())
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

    #[test]
    fn unicode_text_is_exchanged_only_after_a_clipboard_shortcut() {
        let mut clipboard = TextClipboard::default();
        let formats = [ClipboardFormat::new(UNICODE_TEXT)];
        clipboard.on_remote_copy(&formats);
        assert!(!clipboard.request_text);
        clipboard.copy_until = Some(Instant::now() + CLIPBOARD_TIMEOUT);
        clipboard.on_remote_copy(&formats);
        assert!(clipboard.request_text);
        let data = FormatDataResponse::new_unicode_string("中文 🌟");
        clipboard.on_format_data_response(data.clone());
        assert_eq!(clipboard.incoming_text, None);
        clipboard.awaiting_text = true;
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
