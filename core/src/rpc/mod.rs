use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppError;

/// v0 기본 테넌트. 데스크톱(로컬 Core)은 user_id를 보내지 않으므로 1로 귀착.
/// 텔레그램 봇 등 멀티유저 클라이언트는 요청 엔벨로프에 user_id를 명시한다.
pub const DEFAULT_USER_ID: i64 = 1;

fn default_user_id() -> i64 {
    DEFAULT_USER_ID
}

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
    /// 요청 컨텍스트의 테넌트. 미지정 시 DEFAULT_USER_ID.
    #[serde(default = "default_user_id")]
    pub user_id: i64,
}

#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct RpcResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl RpcResponse {
    pub fn success(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn error(id: Value, err: AppError) -> Self {
        let code = err.rpc_code();
        let message = err.to_string();
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(RpcError {
                code,
                message,
                data: None,
            }),
        }
    }

    pub fn parse_error(id: Value, msg: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(RpcError {
                code: -32700,
                message: msg.into(),
                data: None,
            }),
        }
    }

    pub fn method_not_found(id: Value, method: &str) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(RpcError {
                code: -32601,
                message: format!("method not found: {method}"),
                data: None,
            }),
        }
    }
}
