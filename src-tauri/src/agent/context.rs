//! Keep encoded image payloads separate from the local text budget and summaries.
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};

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
    let messages: Vec<_> = messages.into_iter().collect();
    let bytes = serde_json::to_vec(&messages)
        .map_err(|_| AppError::internal("无法计算上下文大小"))?
        .len();
    Ok(bytes.saturating_sub(image_bytes(messages)))
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
        oversized[0]["content"][0]["text"] = "x".repeat(1_000_001).into();
        assert!(super::super::limits::Limits::default()
            .check_context(&oversized, None)
            .is_err());
    }
}
