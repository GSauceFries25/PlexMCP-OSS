//! MCP (Model Context Protocol) Proxy Module
//!
//! This module implements the core MCP proxy functionality for PlexMCP.
//! It allows users to connect multiple upstream MCPs and access them
//! through a single unified endpoint.
//!
//! # Architecture
//!
//! ```text
//! Client (Claude/Cursor) --> PlexMCP Proxy --> Upstream MCP 1 (GitHub)
//!                                          --> Upstream MCP 2 (Supabase)
//!                                          --> Upstream MCP N (...)
//! ```
//!
//! # Features
//!
//! - Tool namespacing: `{mcp_name}:{tool_name}` to prevent conflicts
//! - Partial failure handling: Returns results from healthy MCPs
//! - SSE streaming support for long-running operations
//! - HTTP and Stdio transport support

pub mod audit;
pub mod circuit_breaker;
pub mod client;
pub mod handlers;
pub mod router;
pub mod streaming;
pub mod types;

pub use audit::{
    log_mcp_request, update_mcp_request_metrics, update_mcp_request_tokens, McpRequestLog,
};
pub use client::McpClient;
pub use handlers::McpProxyHandler;
pub use router::McpRouter;
pub use types::*;
