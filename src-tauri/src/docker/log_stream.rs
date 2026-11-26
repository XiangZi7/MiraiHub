use crate::error::{AppError, AppResult};

const ERROR_LIMIT: usize = 4096;

#[derive(Default)]
enum Format {
    #[default]
    Unknown,
    Tty,
    Framed,
}

/// 原生请求带时间戳：TTY 的首字节为时间戳，非 TTY 的首字节为流编号。
#[derive(Default)]
pub(super) struct LogDecoder {
    format: Format,
    header: [u8; 8],
    header_len: usize,
    remaining: u32,
    error_payload: Vec<u8>,
    utf8: Utf8Tail,
}

impl LogDecoder {
    pub(super) fn push(&mut self, mut bytes: &[u8]) -> AppResult<String> {
        let mut output = String::new();
        let Some(&first) = bytes.first() else {
            return Ok(output);
        };
        if matches!(self.format, Format::Unknown) {
            self.format = if first <= 3 {
                Format::Framed
            } else {
                Format::Tty
            };
        }
        if matches!(self.format, Format::Tty) {
            self.utf8.append(bytes, &mut output);
            return Ok(output);
        }
        while !bytes.is_empty() {
            if self.remaining == 0 {
                let take = bytes.len().min(self.header.len() - self.header_len);
                self.header[self.header_len..self.header_len + take]
                    .copy_from_slice(&bytes[..take]);
                self.header_len += take;
                bytes = &bytes[take..];
                if self.header_len < self.header.len() {
                    break;
                }
                self.header_len = 0;
                if self.header[0] > 3 || self.header[1..4] != [0; 3] {
                    return Err(invalid_frame());
                }
                self.remaining = u32::from_be_bytes(self.header[4..8].try_into().unwrap());
            }
            let take = bytes.len().min(self.remaining as usize);
            let (payload, rest) = bytes.split_at(take);
            bytes = rest;
            self.remaining -= take as u32;
            if self.header[0] == 3 {
                let keep = payload.len().min(ERROR_LIMIT - self.error_payload.len());
                self.error_payload.extend_from_slice(&payload[..keep]);
                if self.remaining == 0 || self.error_payload.len() == ERROR_LIMIT {
                    return Err(AppError::network(String::from_utf8_lossy(
                        &self.error_payload,
                    )));
                }
            } else {
                self.utf8.append(payload, &mut output);
            }
        }
        Ok(output)
    }

    pub(super) fn finish(&mut self) -> AppResult<String> {
        if self.header_len != 0 || self.remaining != 0 {
            return Err(invalid_frame());
        }
        let end = if self.utf8.len == 0 { "" } else { "�" };
        self.utf8.len = 0;
        Ok(end.to_owned())
    }
}

fn invalid_frame() -> AppError {
    AppError::network("Docker 日志帧不完整或格式无效")
}

/// 只保留最后一个未完成字符。标准输出和错误输出合并展示，字符可以跨帧。
#[derive(Default)]
struct Utf8Tail {
    bytes: [u8; 4],
    len: usize,
}

impl Utf8Tail {
    fn append(&mut self, mut bytes: &[u8], output: &mut String) {
        while self.len != 0 && !bytes.is_empty() {
            let mut prefix = self.bytes;
            let take = bytes.len().min(prefix.len() - self.len);
            prefix[self.len..self.len + take].copy_from_slice(&bytes[..take]);
            let size = self.len + take;
            bytes = &bytes[take..];
            self.len = 0;
            self.decode(&prefix[..size], output);
        }
        if !bytes.is_empty() {
            self.decode(bytes, output);
        }
    }

    fn decode(&mut self, mut bytes: &[u8], output: &mut String) {
        loop {
            match std::str::from_utf8(bytes) {
                Ok(text) => {
                    output.push_str(text);
                    return;
                }
                Err(error) => {
                    let (valid, rest) = bytes.split_at(error.valid_up_to());
                    output.push_str(std::str::from_utf8(valid).unwrap());
                    if let Some(skip) = error.error_len() {
                        output.push('�');
                        bytes = &rest[skip..];
                    } else {
                        self.bytes[..rest.len()].copy_from_slice(rest);
                        self.len = rest.len();
                        return;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(stream: u8, payload: &[u8]) -> Vec<u8> {
        let mut data = vec![stream, 0, 0, 0];
        data.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        data.extend_from_slice(payload);
        data
    }

    fn decode(chunks: &[&[u8]]) -> AppResult<String> {
        let mut decoder = LogDecoder::default();
        let mut output = String::new();
        for chunk in chunks {
            output.push_str(&decoder.push(chunk)?);
        }
        output.push_str(&decoder.finish()?);
        Ok(output)
    }

    #[test]
    fn tty_and_multiplexed_output_match_lossy_utf8_at_all_split_positions() {
        let text = [
            b"2026 ".as_slice(),
            "跨帧🧪".as_bytes(),
            &[0xe5, 0x90, 0xff, b'A', 0xf0, 0x9f],
        ]
        .concat();
        let expected = String::from_utf8_lossy(&text);
        let framed = [
            frame(1, &text[..6]),
            frame(2, &[]),
            frame(2, &text[6..9]),
            frame(1, &text[9..]),
        ]
        .concat();
        for wire in [&text, &framed] {
            for split in 0..=wire.len() {
                assert_eq!(decode(&[&wire[..split], &wire[split..]]).unwrap(), expected);
            }
            assert_eq!(
                decode(&wire.chunks(1).collect::<Vec<_>>()).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn long_frames_emit_partial_output_and_truncated_frames_fail_at_eof() {
        let header = [1, 0, 0, 0, 0xff, 0xff, 0xff, 0xff];
        let mut decoder = LogDecoder::default();
        assert_eq!(decoder.push(&header).unwrap(), "");
        assert_eq!(decoder.push(b"initial bytes").unwrap(), "initial bytes");
        assert!(decoder.finish().is_err());
        for end in 1..8 {
            assert!(decode(&[&header[..end]]).is_err());
        }
        assert_eq!(decode(&[&[], &frame(1, &[])]).unwrap(), "");
        assert!(decode(&[&[1, 1, 0, 0, 0, 0, 0, 0]]).is_err());
        assert!(decode(&[&frame(1, b"a"), &frame(4, b"unknown")]).is_err());
    }

    #[test]
    fn split_driver_error_is_reported_and_capped() {
        let wire = frame(3, "驱动错误".as_bytes());
        let error = decode(&wire.chunks(1).collect::<Vec<_>>()).unwrap_err();
        assert_eq!(error.message, "驱动错误");
        let error = decode(&[&frame(3, &vec![b'x'; ERROR_LIMIT + 20])]).unwrap_err();
        assert_eq!(error.message.len(), ERROR_LIMIT);
    }
}
