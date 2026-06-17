//! LangSmith(OTel) trace export. `langsmith` feature에서만 실제 동작.
//! 게이팅: feature 켜짐 + `LANGSMITH_API_KEY` env 존재 시에만 활성.
//! trace는 chat agent loop이 생성한다(turn=chain, LLM 호출=llm, 도구=tool).
//!
//! feature가 꺼져 있으면 아래 모든 함수가 no-op 스텁 → 호출부는 cfg 분기 없이 쓴다.

#[cfg(feature = "langsmith")]
mod imp {
    use std::collections::HashMap;
    use std::sync::OnceLock;

    use opentelemetry::global;
    use opentelemetry::trace::{Span, SpanKind, TraceContextExt, Tracer};
    use opentelemetry::{Context, KeyValue};
    use opentelemetry_otlp::{Protocol, SpanExporter, WithExportConfig, WithHttpConfig};
    use opentelemetry_sdk::trace::SdkTracerProvider;

    const DEFAULT_ENDPOINT: &str = "https://api.smith.langchain.com/otel/v1/traces";

    static PROVIDER: OnceLock<Option<SdkTracerProvider>> = OnceLock::new();

    pub fn init() {
        PROVIDER.get_or_init(build_provider);
    }

    fn build_provider() -> Option<SdkTracerProvider> {
        let api_key = std::env::var("LANGSMITH_API_KEY")
            .ok()
            .filter(|s| !s.is_empty())?;
        let project =
            std::env::var("LANGSMITH_PROJECT").unwrap_or_else(|_| "personal-assistant".into());
        let endpoint =
            std::env::var("LANGSMITH_OTEL_ENDPOINT").unwrap_or_else(|_| DEFAULT_ENDPOINT.into());

        let mut headers = HashMap::new();
        headers.insert("x-api-key".to_string(), api_key);
        headers.insert("Langsmith-Project".to_string(), project);

        // reqwest 0.13에 rustls·native-tls가 동시에 켜져 기본 선택(rustls+aws-lc-rs)이
        // crypto provider 없이 실패 → export "network error". native-tls(schannel)로 명시한
        // blocking 클라이언트를 직접 주입해 우회.
        let http_client = reqwest_otlp_tls::blocking::Client::builder()
            .use_native_tls()
            .build()
            .map_err(|e| tracing::warn!(error = %e, "OTLP reqwest 클라이언트 build 실패"))
            .ok()?;

        let exporter = SpanExporter::builder()
            .with_http()
            .with_http_client(http_client)
            .with_protocol(Protocol::HttpBinary)
            .with_endpoint(endpoint)
            .with_headers(headers)
            .build()
            .map_err(|e| tracing::warn!(error = %e, "LangSmith OTLP exporter init 실패"))
            .ok()?;

        let provider = SdkTracerProvider::builder()
            .with_batch_exporter(exporter)
            .build();
        global::set_tracer_provider(provider.clone());
        tracing::info!("LangSmith OTel trace export 활성");
        Some(provider)
    }

    fn enabled() -> bool {
        matches!(PROVIDER.get(), Some(Some(_)))
    }

    pub fn shutdown() {
        if let Some(Some(p)) = PROVIDER.get() {
            let _ = p.force_flush();
            let _ = p.shutdown();
        }
    }

    /// 채팅 한 턴(chain). Context에 부모 span을 담아 자식 span 생성에 넘긴다.
    /// Drop 시 부모 span을 종료하므로 호출부의 여러 return 경로를 신경 쓸 필요 없다.
    pub struct TurnSpan {
        cx: Context,
    }

    pub fn start_turn(user_message: &str) -> Option<TurnSpan> {
        if !enabled() {
            return None;
        }
        let tracer = global::tracer("pa-core");
        let mut span = tracer
            .span_builder("agent_turn")
            .with_kind(SpanKind::Internal)
            .start(&tracer);
        span.set_attribute(KeyValue::new("langsmith.span.kind", "chain"));
        span.set_attribute(KeyValue::new("input.value", user_message.to_string()));
        Some(TurnSpan {
            cx: Context::current().with_span(span),
        })
    }

    impl TurnSpan {
        /// LLM 호출 1건(llm). messages = (role, content) 순서 보존.
        pub fn record_llm(
            &self,
            model: &str,
            messages: &[(String, Option<String>)],
            input_tokens: u32,
            output_tokens: u32,
            completion: Option<&str>,
        ) {
            let tracer = global::tracer("pa-core");
            let mut span = tracer
                .span_builder("chat_completion")
                .with_kind(SpanKind::Client)
                .start_with_context(&tracer, &self.cx);
            span.set_attribute(KeyValue::new("langsmith.span.kind", "llm"));
            span.set_attribute(KeyValue::new("gen_ai.system", "openai"));
            span.set_attribute(KeyValue::new("gen_ai.request.model", model.to_string()));
            for (i, (role, content)) in messages.iter().enumerate() {
                span.set_attribute(KeyValue::new(
                    format!("gen_ai.prompt.{i}.role"),
                    role.to_string(),
                ));
                if let Some(c) = content {
                    span.set_attribute(KeyValue::new(
                        format!("gen_ai.prompt.{i}.content"),
                        c.to_string(),
                    ));
                }
            }
            if let Some(c) = completion {
                span.set_attribute(KeyValue::new("gen_ai.completion.0.role", "assistant"));
                span.set_attribute(KeyValue::new("gen_ai.completion.0.content", c.to_string()));
            }
            span.set_attribute(KeyValue::new(
                "gen_ai.usage.input_tokens",
                input_tokens as i64,
            ));
            span.set_attribute(KeyValue::new(
                "gen_ai.usage.output_tokens",
                output_tokens as i64,
            ));
            span.end();
        }

        /// 도구 실행 1건(tool).
        pub fn record_tool(&self, name: &str, args: &str, result: &str) {
            let tracer = global::tracer("pa-core");
            let mut span = tracer
                .span_builder(format!("tool:{name}"))
                .with_kind(SpanKind::Internal)
                .start_with_context(&tracer, &self.cx);
            span.set_attribute(KeyValue::new("langsmith.span.kind", "tool"));
            span.set_attribute(KeyValue::new("gen_ai.tool.name", name.to_string()));
            span.set_attribute(KeyValue::new("input.value", args.to_string()));
            span.set_attribute(KeyValue::new("output.value", result.to_string()));
            span.end();
        }
    }

    impl Drop for TurnSpan {
        fn drop(&mut self) {
            self.cx.span().end();
        }
    }
}

#[cfg(not(feature = "langsmith"))]
mod imp {
    pub struct TurnSpan;

    pub fn init() {}
    pub fn shutdown() {}
    pub fn start_turn(_user_message: &str) -> Option<TurnSpan> {
        None
    }

    impl TurnSpan {
        pub fn record_llm(
            &self,
            _model: &str,
            _messages: &[(String, Option<String>)],
            _input_tokens: u32,
            _output_tokens: u32,
            _completion: Option<&str>,
        ) {
        }
        pub fn record_tool(&self, _name: &str, _args: &str, _result: &str) {}
    }
}

pub use imp::{init, shutdown, start_turn, TurnSpan};
