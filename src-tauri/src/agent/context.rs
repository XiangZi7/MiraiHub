//! Keep encoded image payloads separate from the local text budget and summaries.
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::collections::VecDeque;

pub(super) const MAX_IMAGE_CONTEXT_BYTES: usize = 28_000_000;

fn images(message: &Value) -> impl Iterator<Item = &Value> {
    message["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|part| {
            part["type"] == "image_url"
                && part["image_url"]["url"]
                    .as_str()
                    .is_some_and(|url| url.starts_with("data:image/"))
        })
}

pub(super) fn image_bytes<'a>(messages: impl IntoIterator<Item = &'a Value>) -> usize {
    messages
        .into_iter()
        .flat_map(images)
        .map(|part| part["image_url"]["url"].as_str().unwrap().len())
        .sum()
}

pub(super) fn text_bytes<'a>(messages: impl IntoIterator<Item = &'a Value>) -> AppResult<usize> {
    struct Counter(usize);
    impl std::io::Write for Counter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 += bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let messages: Vec<_> = messages.into_iter().collect();
    // Count the serialized request without allocating a second 64 MB transcript.
    let mut counter = Counter(0);
    serde_json::to_writer(&mut counter, &messages)
        .map_err(|_| AppError::internal("无法计算上下文大小"))?;
    Ok(counter.0.saturating_sub(image_bytes(messages)))
}

#[derive(Default, Debug)]
pub(super) struct SummaryChunk {
    pub text: String,
    pub images: Vec<Value>,
}

impl SummaryChunk {
    pub fn content(&self) -> Value {
        if self.images.is_empty() {
            return Value::String(self.text.clone());
        }
        let mut content = vec![json!({"type":"text", "text":self.text})];
        content.extend(self.images.iter().cloned());
        Value::Array(content)
    }

    pub fn split(self, budget: usize) -> VecDeque<Self> {
        let mut result = VecDeque::new();
        let mut pending = Self::default();
        append_summary_text(&mut pending, &mut result, &self.text, budget);
        for image in self.images {
            pending.images.push(image);
            result.push_back(std::mem::take(&mut pending));
        }
        if !pending.text.is_empty() {
            result.push_back(pending);
        }
        result
    }
}

fn append_summary_text(
    pending: &mut SummaryChunk,
    chunks: &mut VecDeque<SummaryChunk>,
    mut text: &str,
    budget: usize,
) {
    let budget = budget.max(4);
    while !text.is_empty() {
        let available = budget.saturating_sub(pending.text.len());
        let mut end = available.min(text.len());
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        if end == 0 {
            chunks.push_back(std::mem::take(pending));
            continue;
        }
        pending.text.push_str(&text[..end]);
        text = &text[end..];
        if pending.text.len() == budget {
            chunks.push_back(std::mem::take(pending));
        }
    }
}

/// Group consecutive transcript excerpts; every byte and image is represented.
/// A long individual tool result can span chunks without truncating its middle.
pub(super) fn summary_chunks(
    messages: &[Value],
    budget: usize,
) -> AppResult<VecDeque<SummaryChunk>> {
    let mut chunks = VecDeque::new();
    let mut pending = SummaryChunk::default();
    for message in messages {
        let content = summary_content(std::slice::from_ref(message))?;
        let (text, images) = match content {
            Value::String(text) => (text, Vec::new()),
            Value::Array(mut blocks) => {
                let text = blocks.remove(0)["text"].as_str().unwrap_or("").to_owned();
                (text, blocks)
            }
            _ => unreachable!(),
        };
        append_summary_text(&mut pending, &mut chunks, &text, budget);
        append_summary_text(&mut pending, &mut chunks, "\n", budget);
        // One image per request: a rejected large image must never be silently dropped.
        for image in images {
            pending.images.push(image);
            chunks.push_back(std::mem::take(&mut pending));
        }
    }
    if !pending.text.is_empty() {
        chunks.push_back(pending);
    }
    Ok(chunks)
}

pub(super) fn summary_content(messages: &[Value]) -> AppResult<Value> {
    let mut transcript = messages.to_vec();
    let mut image_blocks = Vec::new();
    for message in &mut transcript {
        if let Some(parts) = message["content"].as_array_mut() {
            for part in parts {
                if part["type"] == "image_url" {
                    image_blocks.push(part.clone());
                    part["image_url"]["url"] = "[image input attached separately]".into();
                }
            }
        }
    }
    let text =
        serde_json::to_string(&transcript).map_err(|_| AppError::internal("无法整理对话上下文"))?;
    if image_blocks.is_empty() {
        return Ok(Value::String(text));
    }
    let mut blocks = vec![json!({"type":"text", "text":text})];
    blocks.extend(image_blocks);
    Ok(Value::Array(blocks))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_do_not_use_the_text_budget_or_become_base64_text_in_summaries() {
        let url = format!("data:image/png;base64,{}", "A".repeat(2_000_000));
        let messages = vec![json!({"role":"user", "content":[
            {"type":"text", "text":"Analyze this screenshot"},
            {"type":"image_url", "image_url":{"url":url}}
        ]})];
        assert!(text_bytes(&messages).unwrap() < 1000);
        assert_eq!(image_bytes(&messages), url.len());
        let summary = summary_content(&messages).unwrap();
        assert!(!summary[0]["text"].as_str().unwrap().contains(&url));
        assert_eq!(summary[1]["image_url"]["url"], url);
        assert_eq!(messages[0]["content"][1]["image_url"]["url"], url);
        assert!(super::super::limits::Limits::default()
            .check_context(&messages, None)
            .is_ok());
        let mut oversized = messages.clone();
        oversized[0]["content"][0]["text"] = "x".repeat(4_000_001).into();
        assert!(super::super::limits::Limits::default()
            .check_context(&oversized, None)
            .is_err());
    }

    #[test]
    fn summary_chunks_bound_unicode_text_without_losing_images_or_content() {
        let messages = vec![
            json!({"role":"user", "content":[
                {"type":"text", "text":"中文😀日志".repeat(100)},
                {"type":"image_url", "image_url":{"url":"data:image/png;base64,AA"}},
                {"type":"image_url", "image_url":{"url":"data:image/png;base64,BB"}}
            ]}),
            json!({"role":"tool", "content":"final error at /var/log/task.log"}),
        ];
        let chunks = summary_chunks(&messages, 80).unwrap();
        assert!(chunks
            .iter()
            .all(|chunk| chunk.text.len() <= 80 && chunk.images.len() <= 1));
        let text: String = chunks.iter().map(|chunk| chunk.text.as_str()).collect();
        assert!(text.contains("中文😀日志"));
        assert!(text.contains("final error at /var/log/task.log"));
        assert!(!text.contains("base64"));
        let images: Vec<_> = chunks.iter().flat_map(|chunk| &chunk.images).collect();
        assert_eq!(images.len(), 2);
        assert_eq!(images[0]["image_url"]["url"], "data:image/png;base64,AA");
        let split_text: String = chunks
            .into_iter()
            .flat_map(|chunk| chunk.split(13))
            .map(|chunk| chunk.text)
            .collect();
        assert_eq!(split_text, text);
    }
}
