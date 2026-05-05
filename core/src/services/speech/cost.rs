pub fn whisper_cost_usd(seconds: f64) -> f64 {
    (seconds / 60.0) * 0.006
}

// gpt-4o-mini-tts: $12/1M input chars. (tts-1 시절 $15/1M 보다 저렴)
pub fn tts_cost_usd(chars: usize) -> f64 {
    (chars as f64 / 1_000_000.0) * 12.0
}
