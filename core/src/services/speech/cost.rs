pub fn whisper_cost_usd(seconds: f64) -> f64 {
    (seconds / 60.0) * 0.006
}

pub fn tts_cost_usd(chars: usize) -> f64 {
    (chars as f64 / 1_000_000.0) * 15.0
}
