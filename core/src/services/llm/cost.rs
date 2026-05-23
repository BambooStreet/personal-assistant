pub struct ModelPricing {
    pub input_per_1m: f64,
    pub output_per_1m: f64,
}

pub fn pricing(model: &str) -> ModelPricing {
    match model {
        "gpt-5-mini" => ModelPricing {
            input_per_1m: 0.25,
            output_per_1m: 2.00,
        },
        "gpt-4o-mini" => ModelPricing {
            input_per_1m: 0.15,
            output_per_1m: 0.60,
        },
        "gpt-4o" => ModelPricing {
            input_per_1m: 2.50,
            output_per_1m: 10.00,
        },
        _ => ModelPricing {
            input_per_1m: 0.25,
            output_per_1m: 2.00,
        },
    }
}

pub fn estimate_chat_cost_usd(model: &str, input_tokens: u32, output_tokens: u32) -> f64 {
    let p = pricing(model);
    (input_tokens as f64 * p.input_per_1m + output_tokens as f64 * p.output_per_1m) / 1_000_000.0
}
