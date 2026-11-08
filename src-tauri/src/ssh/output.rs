//! 交互式 shell 的输出处理：合并短时间内的数据块再推给前端，并保留最近的纯文本输出。
//!
//! 远端程序常把输出拆成大量很小的写入（逐行刷新、进度条），每块各走一次 IPC
//! 会让前端频繁唤醒。这里在 [`FLUSH_DELAY`] 内或累计到 [`FLUSH_BYTES`] 时合并发送，
//! 顺序不变，shell 结束时把剩余数据一次冲刷出去。
//!
//! 同时把输出去掉 ANSI 控制序列后写入环形缓冲（最近 [`HISTORY_LINES`] 行），
//! 供 AI 读取终端上刚刚出现的命令输出。

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::{ChannelMsg, ChannelReadHalf};
use tokio::time::Instant;

/// 首块数据到达后最多等待这么久再发送。
pub const FLUSH_DELAY: Duration = Duration::from_millis(8);
/// 累计到这么多字节立即发送，避免大量输出时单次 IPC 过大或延迟过高。
pub const FLUSH_BYTES: usize = 32 * 1024;
/// 每个会话保留的最近输出行数。
pub const HISTORY_LINES: usize = 2000;
/// 单行最多保留的字符数，超出部分丢弃（防止无换行的超长输出撑爆内存）。
const MAX_LINE_CHARS: usize = 2048;

/// 输出泵读取消息的来源；生产环境是 shell 通道的读半边，测试用内存队列代替。
pub(crate) trait MessageSource {
    /// 取下一条通道消息，通道关闭时返回 None。实现必须可安全取消。
    async fn next_message(&mut self) -> Option<ChannelMsg>;
}

impl MessageSource for ChannelReadHalf {
    async fn next_message(&mut self) -> Option<ChannelMsg> {
        self.wait().await
    }
}

/// 读到 shell 结束为止：合并数据块交给 `send`，同时写入终端历史。返回远端退出码。
pub(crate) async fn forward_output<S, F>(
    source: &mut S,
    history: &TerminalHistory,
    mut send: F,
) -> Option<u32>
where
    S: MessageSource,
    F: FnMut(Vec<u8>),
{
    let mut pending: Vec<u8> = Vec::new();
    let mut deadline: Option<Instant> = None;
    let mut exit_code = None;

    loop {
        tokio::select! {
            // 先处理新消息再看定时器：数据持续涌入时也会在达到字节上限时及时发送
            biased;
            message = source.next_message() => {
                let Some(message) = message else { break };
                match message {
                    ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, ext: 1 } => {
                        history.push(&data);
                        pending.extend_from_slice(&data);
                        if pending.len() >= FLUSH_BYTES {
                            send(std::mem::take(&mut pending));
                            deadline = None;
                        } else if deadline.is_none() {
                            deadline = Some(Instant::now() + FLUSH_DELAY);
                        }
                    }
                    ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
                    ChannelMsg::Eof | ChannelMsg::Close => break,
                    _ => {}
                }
            }
            _ = sleep_until(deadline), if deadline.is_some() => {
                if !pending.is_empty() {
                    send(std::mem::take(&mut pending));
                }
                deadline = None;
            }
        }
    }

    // shell 结束时把最后一批数据冲刷出去，保证前端看到完整输出
    if !pending.is_empty() {
        send(pending);
    }
    history.finish();
    exit_code
}

/// 等到指定时刻；没有截止时间时永远挂起（配合 select! 的条件分支使用）。
async fn sleep_until(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}

/// 多线程共享的终端历史，会话与输出泵各持一份。
#[derive(Clone, Default)]
pub struct TerminalHistory(Arc<Mutex<TextScreen>>);

impl TerminalHistory {
    /// 写入一段原始输出字节。
    pub fn push(&self, data: &[u8]) {
        if let Ok(mut screen) = self.0.lock() {
            screen.feed(data);
        }
    }

    /// 输出结束：把未完成的 UTF-8 片段按替换字符处理。
    fn finish(&self) {
        if let Ok(mut screen) = self.0.lock() {
            screen.flush_utf8();
        }
    }

    /// 最近 n 行纯文本（含当前未换行的一行，例如提示符），按从旧到新排列。
    pub fn recent_lines(&self, n: usize) -> Vec<String> {
        self.0
            .lock()
            .map(|screen| screen.recent(n))
            .unwrap_or_default()
    }
}

/// 控制序列解析状态。
#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Escape {
    #[default]
    None,
    /// 刚读到 ESC
    Esc,
    /// ESC 后跟字符集选择等中间字节，再吞掉一个字符
    EscIntermediate,
    /// CSI：ESC [ ... 终止字节
    Csi,
    /// OSC：ESC ] ... BEL 或 ST
    Osc,
    /// DCS / SOS / PM / APC：直到 ST
    Str,
    /// 字符串序列中读到 ESC，等待 `\` 组成 ST
    StrEsc,
}

/// 把终端输出近似还原成纯文本行。
///
/// 只模拟单行内的光标移动：`\r` 回到行首覆盖、退格左移、`ESC[K` 擦除、
/// `ESC[nC/D/G` 横向移动；全屏程序（备用屏幕）期间的输出不记录。
#[derive(Default)]
struct TextScreen {
    lines: VecDeque<String>,
    current: Vec<char>,
    cursor: usize,
    escape: Escape,
    csi: String,
    utf8: Vec<u8>,
    alternate: bool,
}

impl TextScreen {
    /// 按字节喂入输出，处理跨块截断的 UTF-8 字符。
    fn feed(&mut self, data: &[u8]) {
        let mut bytes = std::mem::take(&mut self.utf8);
        bytes.extend_from_slice(data);
        let mut rest: &[u8] = &bytes;
        loop {
            match std::str::from_utf8(rest) {
                Ok(text) => {
                    text.chars().for_each(|ch| self.put(ch));
                    break;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    // SAFETY 等价：valid_up_to 之前一定是合法 UTF-8
                    std::str::from_utf8(&rest[..valid])
                        .unwrap_or_default()
                        .chars()
                        .for_each(|ch| self.put(ch));
                    match error.error_len() {
                        Some(len) => {
                            self.put('\u{fffd}');
                            rest = &rest[valid + len..];
                        }
                        None => {
                            // 末尾是被截断的多字节字符，留到下一块再拼
                            self.utf8 = rest[valid..].to_vec();
                            break;
                        }
                    }
                }
            }
        }
    }

    /// 丢弃残留的半个字符。
    fn flush_utf8(&mut self) {
        if !std::mem::take(&mut self.utf8).is_empty() {
            self.put('\u{fffd}');
        }
    }

    /// 处理一个字符：先过控制序列状态机，再落到当前行。
    fn put(&mut self, ch: char) {
        match self.escape {
            Escape::None => {}
            Escape::Esc => {
                self.escape = match ch {
                    '[' => {
                        self.csi.clear();
                        Escape::Csi
                    }
                    ']' => Escape::Osc,
                    'P' | 'X' | '^' | '_' => Escape::Str,
                    '(' | ')' | '*' | '+' | '-' | '.' | '/' | '#' | '%' | ' ' => {
                        Escape::EscIntermediate
                    }
                    _ => Escape::None,
                };
                return;
            }
            Escape::EscIntermediate => {
                self.escape = Escape::None;
                return;
            }
            Escape::Csi => {
                if ('\u{40}'..='\u{7e}').contains(&ch) {
                    self.escape = Escape::None;
                    let params = std::mem::take(&mut self.csi);
                    self.csi_command(&params, ch);
                } else if self.csi.len() < 64 {
                    self.csi.push(ch);
                }
                return;
            }
            Escape::Osc | Escape::Str => {
                match ch {
                    '\u{07}' if self.escape == Escape::Osc => self.escape = Escape::None,
                    '\u{1b}' => self.escape = Escape::StrEsc,
                    '\u{9c}' => self.escape = Escape::None,
                    _ => {}
                }
                return;
            }
            Escape::StrEsc => {
                self.escape = if ch == '\\' { Escape::None } else { Escape::Str };
                return;
            }
        }

        match ch {
            '\u{1b}' => self.escape = Escape::Esc,
            '\u{9b}' => {
                self.csi.clear();
                self.escape = Escape::Csi;
            }
            _ if self.alternate => {}
            '\n' => self.commit(),
            '\r' => self.cursor = 0,
            '\u{08}' => self.cursor = self.cursor.saturating_sub(1),
            '\t' => {
                let next = (self.cursor / 8 + 1) * 8;
                while self.cursor < next {
                    self.write(' ');
                }
            }
            ch if ch.is_control() => {}
            ch => self.write(ch),
        }
    }

    /// 在光标处写入一个可见字符（覆盖已有字符）。
    fn write(&mut self, ch: char) {
        if self.cursor >= MAX_LINE_CHARS {
            return;
        }
        while self.current.len() < self.cursor {
            self.current.push(' ');
        }
        if self.cursor < self.current.len() {
            self.current[self.cursor] = ch;
        } else {
            self.current.push(ch);
        }
        self.cursor += 1;
    }

    /// 执行影响当前行文本的 CSI 指令，其余（颜色、滚动区域等）忽略。
    fn csi_command(&mut self, params: &str, command: char) {
        let private = params.starts_with('?');
        let numbers: Vec<usize> = params
            .trim_start_matches(['?', '>', '='])
            .split(';')
            .map(|value| value.parse().unwrap_or(0))
            .collect();
        let first = numbers.first().copied().unwrap_or(0);
        let count = first.max(1);
        match command {
            'h' | 'l' if private => {
                // 1049/1047/47：备用屏幕。vim、top 等全屏程序的画面不是有意义的输出
                if numbers.iter().any(|n| matches!(n, 47 | 1047 | 1049)) {
                    let entering = command == 'h';
                    if entering && !self.current.is_empty() {
                        self.commit();
                    }
                    self.alternate = entering;
                    self.cursor = 0;
                }
            }
            _ if self.alternate => {}
            'K' => match first {
                0 => self.current.truncate(self.cursor),
                1 => {
                    let end = (self.cursor + 1).min(self.current.len());
                    self.current[..end].iter_mut().for_each(|c| *c = ' ');
                }
                _ => self.current.clear(),
            },
            'P' => {
                // 删除光标处字符，行尾左移（readline 编辑时常用）
                let end = (self.cursor + count).min(self.current.len());
                if self.cursor < end {
                    self.current.drain(self.cursor..end);
                }
            }
            'C' => self.cursor = (self.cursor + count).min(MAX_LINE_CHARS),
            'D' => self.cursor = self.cursor.saturating_sub(count),
            'G' => self.cursor = (count - 1).min(MAX_LINE_CHARS),
            // 清屏后之前的输出依然是历史，只需把当前行收尾
            'J' if first >= 2 && !self.current.is_empty() => self.commit(),
            _ => {}
        }
    }

    /// 当前行结束，存入历史。
    fn commit(&mut self) {
        let mut line: String = self.current.drain(..).collect();
        line.truncate(line.trim_end().len());
        self.cursor = 0;
        if self.lines.len() >= HISTORY_LINES {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }

    /// 最近 n 行，当前行非空时计入最后一行。
    fn recent(&self, n: usize) -> Vec<String> {
        let current: String = self.current.iter().collect();
        let current = current.trim_end();
        let partial = (!current.is_empty()).then(|| current.to_owned());
        let take_full = n.saturating_sub(partial.is_some() as usize);
        let skip = self.lines.len().saturating_sub(take_full);
        self.lines
            .iter()
            .skip(skip)
            .cloned()
            .chain(partial)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn screen(input: &str) -> Vec<String> {
        let history = TerminalHistory::default();
        history.push(input.as_bytes());
        history.recent_lines(100)
    }

    #[test]
    fn strips_colors_osc_and_handles_carriage_return() {
        assert_eq!(
            screen("\x1b]0;user@host: ~\x07\x1b[01;32muser@host\x1b[00m:~$ ls\r\nfile.txt\r\n"),
            ["user@host:~$ ls", "file.txt"]
        );
        // 进度条用 \r 覆盖同一行，只保留最终状态
        assert_eq!(screen("10%\r50%\r100% done\n"), ["100% done"]);
        assert_eq!(screen("abcdef\rxy\x1b[K\n"), ["xy"]);
    }

    #[test]
    fn approximates_backspace_and_cursor_moves() {
        assert_eq!(screen("lss\x08 \x08\n"), ["ls"]);
        assert_eq!(screen("hello\x1b[3Dy\n"), ["heylo"]);
        assert_eq!(screen("abc\x1b[1G\x1b[1Pz\n"), ["zc"]);
        assert_eq!(screen("a\tb\n"), ["a       b"]);
    }

    #[test]
    fn skips_alternate_screen_and_keeps_prompt_line() {
        assert_eq!(
            screen("$ vim a\r\n\x1b[?1049hGARBAGE\r\nmore\x1b[?1049l$ "),
            ["$ vim a", "$"]
        );
    }

    #[test]
    fn utf8_split_across_chunks_and_ring_capacity() {
        let history = TerminalHistory::default();
        let text = "中文\n".as_bytes();
        history.push(&text[..2]);
        history.push(&text[2..]);
        assert_eq!(history.recent_lines(5), ["中文"]);

        for index in 0..HISTORY_LINES + 10 {
            history.push(format!("line {index}\n").as_bytes());
        }
        let all = history.recent_lines(usize::MAX);
        assert_eq!(all.len(), HISTORY_LINES);
        assert_eq!(all.last().unwrap(), &format!("line {}", HISTORY_LINES + 9));
        assert_eq!(history.recent_lines(2).len(), 2);
    }

    struct Queue(tokio::sync::mpsc::UnboundedReceiver<ChannelMsg>);
    impl MessageSource for Queue {
        async fn next_message(&mut self) -> Option<ChannelMsg> {
            self.0.recv().await
        }
    }

    fn data(bytes: &[u8]) -> ChannelMsg {
        ChannelMsg::Data {
            data: russh::CryptoVec::from_slice(bytes),
        }
    }

    #[tokio::test]
    async fn coalesces_bursts_and_flushes_on_close_in_order() {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        for chunk in [&b"a"[..], b"b", b"c"] {
            tx.send(data(chunk)).unwrap();
        }
        tx.send(ChannelMsg::ExitStatus { exit_status: 3 }).unwrap();
        tx.send(data(b"d")).unwrap();
        tx.send(ChannelMsg::Eof).unwrap();
        let history = TerminalHistory::default();
        let mut sent = Vec::new();
        let code = forward_output(&mut Queue(rx), &history, |chunk| sent.push(chunk)).await;
        assert_eq!(code, Some(3));
        // 消息全部已就绪，合并成一次发送
        assert_eq!(sent, [b"abcd".to_vec()]);
        assert_eq!(history.recent_lines(1), ["abcd"]);
    }

    #[tokio::test]
    async fn flushes_after_delay_and_at_byte_limit() {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let history = TerminalHistory::default();
        let sent = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
        let sink = sent.clone();
        let task = tokio::spawn(async move {
            let mut source = Queue(rx);
            forward_output(&mut source, &history, |chunk| sink.lock().unwrap().push(chunk)).await
        });

        tx.send(data(b"x")).unwrap();
        // 不关闭通道，只等定时器：首块之后应在延迟到期时单独发送
        tokio::time::sleep(FLUSH_DELAY * 10).await;
        assert_eq!(sent.lock().unwrap().as_slice(), [b"x".to_vec()]);

        let big = vec![b'y'; FLUSH_BYTES];
        tx.send(data(&big)).unwrap();
        tx.send(data(b"z")).unwrap();
        drop(tx);
        assert_eq!(task.await.unwrap(), None);
        let sent = sent.lock().unwrap();
        assert_eq!(sent.len(), 3);
        assert_eq!(sent[1], big);
        assert_eq!(sent[2], b"z");
    }
}
