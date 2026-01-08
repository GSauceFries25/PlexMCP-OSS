//! SSE (Server-Sent Events) streaming support for MCP proxy
//!
//! Enables streaming partial results as MCPs respond in aggregation requests,
//! providing better user experience for long-running operations.

use super::types::{JsonRpcError, JsonRpcResponse};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Events that can be streamed to the client via SSE
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum McpStreamEvent {
    /// Progress update for long-running operation
    Progress {
        current: u32,
        total: u32,
        message: String,
    },

    /// Partial result (e.g., first MCP responded in aggregation)
    PartialResult {
        source: String, // MCP name
        data: Value,
    },

    /// Final complete result
    FinalResult { response: JsonRpcResponse },

    /// Error occurred
    Error { error: JsonRpcError },

    /// Heartbeat to keep connection alive
    Heartbeat,
}

impl McpStreamEvent {
    /// Convert event to SSE data string
    pub fn to_sse_data(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    /// Get the SSE event type name
    pub fn event_type(&self) -> &'static str {
        match self {
            McpStreamEvent::Progress { .. } => "progress",
            McpStreamEvent::PartialResult { .. } => "partial",
            McpStreamEvent::FinalResult { .. } => "result",
            McpStreamEvent::Error { .. } => "error",
            McpStreamEvent::Heartbeat => "heartbeat",
        }
    }
}
