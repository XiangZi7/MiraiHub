//! Provider-reported usage only; absent counters stay unknown rather than guessed.
use super::{config::ApiFormat, Entry};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct Metrics {
    pub context_pressure_limit: Option<usize>,
    pub requests: u64,
    pub total_tokens: u64,
    pub token_reports: u64,
    pub cached_tokens: u64,
    pub cache_input_tokens: u64,
    pub cache_reports: u64,
    pub last_input_bytes: Option<usize>,
    pub context_input_tokens: Option<u64>,
    pub last_input_tokens: Option<u64>,
    pub tokens_per_second: Option<f64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub rounds: usize,
    pub steps: u64,
    pub total_tokens: Option<u64>,
    pub tokens_per_second: Option<f64>,
    pub cache_hit_rate: Option<f64>,
    pub reported_requests: u64,
    pub cache_reported_requests: u64,
    pub last_input_tokens: Option<u64>,
    pub estimated_context_tokens: usize,
    pub context_window_tokens: usize,
    pub context_bytes: usize,
    pub context_limit_bytes: usize,
}

impl Metrics {
    pub fn estimate(&self, bytes: usize) -> usize {
        super::budget::estimate(bytes, self.last_input_bytes.zip(self.context_input_tokens))
    }
    pub fn begin_request(&mut self) {
        self.requests = self.requests.saturating_add(1);
    }
    pub fn record(&mut self, response: &Value, format: ApiFormat, elapsed_ms: u64) {
        let usage = &response["usage"];
        let read = |key: &str| usage[key].as_u64();
        let cached = read("prompt_cache_hit_tokens")
            .or_else(|| usage["prompt_tokens_details"]["cached_tokens"].as_u64())
            .or_else(|| usage["input_tokens_details"]["cached_tokens"].as_u64())
            .or_else(|| read("cache_read_input_tokens"));
        let input = if format == ApiFormat::Anthropic {
            read("input_tokens").map(|input| {
                input
                    .saturating_add(read("cache_read_input_tokens").unwrap_or(0))
                    .saturating_add(read("cache_creation_input_tokens").unwrap_or(0))
            })
        } else {
            read("prompt_tokens").or_else(|| read("input_tokens"))
        };
        let output = read("completion_tokens").or_else(|| read("output_tokens"));
        let total = input
            .zip(output)
            .map(|(a, b)| a.saturating_add(b))
            .or_else(|| read("total_tokens"));
        if let Some(total) = total {
            self.total_tokens = self.total_tokens.saturating_add(total);
            self.token_reports = self.token_reports.saturating_add(1);
        }
        if let Some((input, cached)) = input.zip(cached) {
            self.cache_input_tokens = self.cache_input_tokens.saturating_add(input);
            self.cached_tokens = self.cached_tokens.saturating_add(cached.min(input));
            self.cache_reports = self.cache_reports.saturating_add(1);
        }
        self.last_input_tokens = input;
        self.tokens_per_second = output
            .filter(|_| elapsed_ms > 0)
            .map(|output| output as f64 * 1000.0 / elapsed_ms as f64);
    }
    pub fn snapshot(
        &self,
        entries: &[Entry],
        context_bytes: usize,
        context_limit_bytes: usize,
    ) -> Snapshot {
        Snapshot {
            rounds: entries.iter().filter(|entry| entry.role == "user").count(),
            steps: self.requests,
            total_tokens: (self.token_reports > 0).then_some(self.total_tokens),
            tokens_per_second: self.tokens_per_second,
            cache_hit_rate: (self.cache_reports > 0).then(|| {
                if self.cache_input_tokens == 0 {
                    0.0
                } else {
                    self.cached_tokens as f64 / self.cache_input_tokens as f64 * 100.0
                }
            }),
            reported_requests: self.token_reports,
            cache_reported_requests: self.cache_reports,
            last_input_tokens: self.last_input_tokens,
            estimated_context_tokens: self.estimate(context_bytes),
            context_window_tokens: 0,
            context_bytes,
            context_limit_bytes,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn provider_usage_preserves_cache_semantics_and_missing_values() {
        let mut metrics = Metrics::default();
        metrics.begin_request();
        metrics.record(&json!({"usage":{"prompt_tokens":1000,"completion_tokens":200,"prompt_cache_hit_tokens":900}}),ApiFormat::Openai,1000);
        assert_eq!(metrics.total_tokens, 1200);
        assert_eq!(metrics.tokens_per_second, Some(200.0));
        metrics.begin_request();
        metrics.record(&json!({"usage":{"input_tokens":50,"output_tokens":100,"cache_read_input_tokens":900,"cache_creation_input_tokens":50}}),ApiFormat::Anthropic,500);
        assert_eq!(metrics.total_tokens, 2300);
        assert_eq!(metrics.cache_input_tokens, 2000);
        assert_eq!(metrics.cached_tokens, 1800);
        metrics.begin_request();
        metrics.record(&json!({}), ApiFormat::Openai, 1000);
        assert_eq!(metrics.total_tokens, 2300);
        assert_eq!(metrics.token_reports, 2);
        assert_eq!(metrics.tokens_per_second, None);
    }
    #[test]
    fn responses_counters_and_unknown_or_invalid_values_are_not_fabricated() {
        let mut metrics = Metrics::default();
        metrics.begin_request();
        assert!(metrics.snapshot(&[], 0, 4000).total_tokens.is_none());
        metrics.record(&json!({"usage":{"input_tokens":80,"output_tokens":20,"input_tokens_details":{"cached_tokens":800}}}),ApiFormat::Responses,0);
        assert_eq!(metrics.total_tokens, 100);
        assert_eq!(metrics.cached_tokens, 80);
        assert_eq!(metrics.tokens_per_second, None);
        assert_eq!(metrics.snapshot(&[], 0, 4000).cache_hit_rate, Some(100.0));
        metrics.record(
            &json!({"usage":{"prompt_tokens":-1,"completion_tokens":"20"}}),
            ApiFormat::Openai,
            100,
        );
        assert_eq!(metrics.token_reports, 1);
    }
}
