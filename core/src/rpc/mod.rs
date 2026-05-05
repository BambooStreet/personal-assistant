use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppError;

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
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
