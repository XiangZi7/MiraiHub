//! Model pressure policy, independent from the local transcript storage limit.
use super::limits::Limits;

pub(super) fn input_threshold(limits: Limits) -> usize {
    let window = limits.context_window_tokens;
    let headroom = (window / 20).min(8192);
    (window * 80 / 100).min(window.saturating_sub(limits.max_output_tokens + headroom))
}

/// Conservative text estimate until a successful provider report calibrates it.
/// Two UTF-8 bytes/token budgets CJK and JSON more cautiously than four chars/token.
pub(super) fn estimate(bytes: usize, last: Option<(usize, u64)>) -> usize {
    match last.filter(|(bytes, _)| *bytes > 0) {
        Some((previous, tokens)) => {
            ((bytes as f64 * tokens as f64 / previous as f64).ceil() as usize).max(1)
        }
        None => bytes.div_ceil(2),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn output_and_headroom_are_reserved_before_model_pressure() {
        let mut limits = Limits::default();
        assert_eq!(input_threshold(limits), 102400);
        limits.max_output_tokens = 65536;
        assert_eq!(input_threshold(limits), 56064);
        assert_eq!(estimate(1000, None), 500);
        assert_eq!(estimate(2000, Some((1000, 300))), 600);
        assert_eq!(estimate(2000, Some((0, 300))), 1000);
    }
}
