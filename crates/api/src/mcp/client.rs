//! MCP Client for Upstream Connections
//!
//! Handles HTTP and Stdio connections to upstream MCP servers.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use reqwest::Client;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::types::*;

/// Timeout for MCP requests (30 seconds)
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Timeout for initialize handshake (10 seconds)
#[allow(dead_code)] // Reserved for future use
const INIT_TIMEOUT: Duration = Duration::from_secs(10);

/// Maximum number of retry attempts for transient failures
const MAX_RETRIES: usize = 3;

/// Initial backoff duration for retries (100ms)
const RETRY_BASE_DELAY: Duration = Duration::from_millis(100);

/// Maximum backoff duration for retries (5 seconds)
const RETRY_MAX_DELAY: Duration = Duration::from_secs(5);

/// Error type for MCP client operations
#[derive(Debug, thiserror::Error)]
pub enum McpClientError {
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),

    #[error("JSON serialization error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Timeout waiting for response")]
    Timeout,

    #[error("MCP server returned error: {0}")]
    McpError(String),

    #[error("Transport not initialized")]
    NotInitialized,

    #[error("Invalid response from server")]
    InvalidResponse,

    #[error("Process spawn failed: {0}")]
    ProcessError(String),
}

impl McpClientError {
    /// Returns true if this error is transient and should be retried
    pub fn is_transient(&self) -> bool {
        match self {
            // Retry network-related errors and timeouts
            McpClientError::HttpError(_) => true,
            McpClientError::Timeout => true,
            McpClientError::IoError(_) => true,

            // Don't retry permanent errors
            McpClientError::McpError(_) => false,
            McpClientError::NotInitialized => false,
            McpClientError::InvalidResponse => false,
            McpClientError::ProcessError(_) => false,
            McpClientError::JsonError(_) => false,
        }
    }
}

/// Result type for MCP client operations
pub type McpResult<T> = Result<T, McpClientError>;

/// Parse response body handling both JSON and SSE (Server-Sent Events) formats
/// GitHub MCP and some other servers return SSE format: "event: message\ndata: {...}"
fn parse_response_body(body: &str) -> McpResult<JsonRpcResponse> {
    let trimmed = body.trim();

    // Check if this is SSE format (starts with "event:" or "data:")
    if trimmed.starts_with("event:") || trimmed.starts_with("data:") {
        // Extract JSON from the data: line
        for line in trimmed.lines() {
            let line = line.trim();
            if let Some(json_str) = line.strip_prefix("data:") {
                let json_str = json_str.trim();
                if !json_str.is_empty() {
                    return serde_json::from_str(json_str).map_err(McpClientError::from);
                }
            }
        }
        return Err(McpClientError::InvalidResponse);
    }

    // Regular JSON response
    serde_json::from_str(trimmed).map_err(McpClientError::from)
}

/// MCP Client for connecting to upstream MCP servers
pub struct McpClient {
    http_client: Client,
    /// Active stdio processes, keyed by MCP ID
    stdio_processes: Arc<Mutex<HashMap<String, StdioProcess>>>,
    /// Session IDs for HTTP MCP endpoints, keyed by endpoint URL
    http_sessions: Arc<Mutex<HashMap<String, String>>>,
    /// Circuit breaker manager for all MCP instances
    circuit_breakers: Arc<crate::mcp::circuit_breaker::McpCircuitBreakerManager>,
}

/// Wrapper for a stdio MCP process
#[allow(dead_code)] // Fields used for process management
struct StdioProcess {
    child: Child,
    stdin: tokio::process::ChildStdin,
    stdout: BufReader<tokio::process::ChildStdout>,
    initialized: bool,
}

impl McpClient {
    /// Create a new MCP client
    #[allow(clippy::expect_used)] // HTTP client creation failure is a fatal system error
    pub fn new() -> Self {
        let http_client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .pool_max_idle_per_host(10)
            .build()
            .expect("Failed to create HTTP client");

        let circuit_breakers =
            Arc::new(crate::mcp::circuit_breaker::McpCircuitBreakerManager::new(
                crate::mcp::circuit_breaker::CircuitBreakerConfig::default(),
            ));

        Self {
            http_client,
            stdio_processes: Arc::new(Mutex::new(HashMap::new())),
            http_sessions: Arc::new(Mutex::new(HashMap::new())),
            circuit_breakers,
        }
    }

    /// Initialize an HTTP MCP session and return the session ID
    pub async fn init_http_session(&self, endpoint_url: &str, auth: &McpAuth) -> McpResult<String> {
        let init_request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(JsonRpcId::Number(1)),
            method: "initialize".to_string(),
            params: Some(serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "PlexMCP",
                    "version": "0.1.0"
                }
            })),
        };

        let mut req_builder = self.http_client.post(endpoint_url);

        // Add authentication headers
        match auth {
            McpAuth::None => {}
            McpAuth::Bearer { token } => {
                req_builder = req_builder.bearer_auth(token);
            }
            McpAuth::ApiKey { header, value } => {
                req_builder = req_builder.header(header.as_str(), value.as_str());
            }
            McpAuth::Basic { username, password } => {
                req_builder = req_builder.basic_auth(username, Some(password));
            }
        }

        let response = req_builder
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .json(&init_request)
            .send()
            .await?;

        // Extract session ID from response headers
        let session_id = response
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        // Parse response to ensure it succeeded
        // Handle both JSON and SSE (Server-Sent Events) formats
        let body = response.text().await?;
        let _json_response: JsonRpcResponse = parse_response_body(&body)?;

        if let Some(session_id) = session_id {
            // Store the session ID
            let mut sessions = self.http_sessions.lock().await;
            sessions.insert(endpoint_url.to_string(), session_id.clone());
            Ok(session_id)
        } else {
            // Server doesn't require session, return empty string
            Ok(String::new())
        }
    }

    /// Get or create a session for an HTTP endpoint
    async fn get_or_create_session(
        &self,
        endpoint_url: &str,
        auth: &McpAuth,
    ) -> McpResult<Option<String>> {
        // Check if we have a cached session
        {
            let sessions = self.http_sessions.lock().await;
            if let Some(session_id) = sessions.get(endpoint_url) {
                if !session_id.is_empty() {
                    return Ok(Some(session_id.clone()));
                } else {
                    return Ok(None); // Server doesn't use sessions
                }
            }
        }

        // No cached session, initialize one
        let session_id = self.init_http_session(endpoint_url, auth).await?;
        if session_id.is_empty() {
            Ok(None)
        } else {
            Ok(Some(session_id))
        }
    }

    /// Send a JSON-RPC request to an HTTP MCP endpoint
    pub async fn send_http_request(
        &self,
        endpoint_url: &str,
        auth: &McpAuth,
        request: &JsonRpcRequest,
    ) -> McpResult<JsonRpcResponse> {
        // Get or create a session for this endpoint
        let session_id = self.get_or_create_session(endpoint_url, auth).await?;

        let mut req_builder = self.http_client.post(endpoint_url);

        // Add authentication headers
        match auth {
            McpAuth::None => {}
            McpAuth::Bearer { token } => {
                req_builder = req_builder.bearer_auth(token);
            }
            McpAuth::ApiKey { header, value } => {
                req_builder = req_builder.header(header.as_str(), value.as_str());
            }
            McpAuth::Basic { username, password } => {
                req_builder = req_builder.basic_auth(username, Some(password));
            }
        }

        // Add session ID header if we have one
        if let Some(ref session_id) = session_id {
            req_builder = req_builder.header("Mcp-Session-Id", session_id.as_str());
        }

        let response = req_builder
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .json(request)
            .send()
            .await?;

        // Check content type for SSE vs JSON
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        if content_type.contains("text/event-stream") {
            // Handle SSE response - collect all events
            self.handle_sse_response(response).await
        } else {
            // Standard JSON response
            let json_response: JsonRpcResponse = response.json().await?;
            Ok(json_response)
        }
    }

    /// Handle SSE response stream
    async fn handle_sse_response(&self, response: reqwest::Response) -> McpResult<JsonRpcResponse> {
        let text = response.text().await?;

        // Parse SSE events - look for the final result
        let mut last_data: Option<JsonRpcResponse> = None;

        for line in text.lines() {
            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(parsed) = serde_json::from_str::<JsonRpcResponse>(data) {
                    last_data = Some(parsed);
                }
            }
        }

        last_data.ok_or(McpClientError::InvalidResponse)
    }

    /// Initialize a stdio MCP process
    pub async fn init_stdio_process(
        &self,
        mcp_id: &str,
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> McpResult<()> {
        let mut cmd = Command::new(command);
        cmd.args(args)
            .envs(env)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            McpClientError::ProcessError(format!("Failed to spawn {}: {}", command, e))
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| McpClientError::ProcessError("Failed to capture stdin".to_string()))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| McpClientError::ProcessError("Failed to capture stdout".to_string()))?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| McpClientError::ProcessError("Failed to capture stderr".to_string()))?;

        // Spawn background task to read stderr and log it
        let mcp_id_clone = mcp_id.to_string();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();

            loop {
                line.clear();

                match reader.read_line(&mut line).await {
                    Ok(0) => {
                        // EOF - process exited
                        tracing::debug!(mcp_id = %mcp_id_clone, "stderr stream closed");
                        break;
                    }
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }

                        // Log based on content
                        if trimmed.contains("ERROR") || trimmed.contains("FATAL") {
                            tracing::error!(mcp_id = %mcp_id_clone, stderr = %trimmed);
                        } else if trimmed.contains("WARN") {
                            tracing::warn!(mcp_id = %mcp_id_clone, stderr = %trimmed);
                        } else {
                            tracing::debug!(mcp_id = %mcp_id_clone, stderr = %trimmed);
                        }
                    }
                    Err(e) => {
                        tracing::error!(mcp_id = %mcp_id_clone, error = %e, "Failed to read stderr");
                        break;
                    }
                }
            }

            tracing::debug!(mcp_id = %mcp_id_clone, "stderr reader task exiting");
        });

        let process = StdioProcess {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            initialized: false,
        };

        let mut processes = self.stdio_processes.lock().await;
        processes.insert(mcp_id.to_string(), process);

        Ok(())
    }

    /// Send a JSON-RPC request to a stdio MCP process
    pub async fn send_stdio_request(
        &self,
        mcp_id: &str,
        request: &JsonRpcRequest,
    ) -> McpResult<JsonRpcResponse> {
        let mut processes = self.stdio_processes.lock().await;
        let process = processes
            .get_mut(mcp_id)
            .ok_or(McpClientError::NotInitialized)?;

        // Serialize request with newline delimiter
        let mut request_json = serde_json::to_string(request)?;
        request_json.push('\n');

        // Write to stdin
        process.stdin.write_all(request_json.as_bytes()).await?;
        process.stdin.flush().await?;

        // Read response from stdout with timeout
        let mut response_line = String::new();

        let read_result = tokio::time::timeout(REQUEST_TIMEOUT, async {
            process.stdout.read_line(&mut response_line).await
        })
        .await;

        let bytes_read = match read_result {
            Ok(Ok(n)) => n,
            Ok(Err(e)) => {
                // Read error - process likely crashed, clean up
                tracing::error!("Failed to read from stdio process {}: {}", mcp_id, e);

                let removed = processes.remove(mcp_id);
                drop(processes);

                if let Some(mut proc) = removed {
                    let _ = proc.child.kill().await;
                    let _ = proc.child.wait().await; // REAP ZOMBIE
                }

                return Err(McpClientError::from(e));
            }
            Err(_) => {
                // Timeout - kill and reap process
                tracing::error!("Timeout reading from stdio process {}", mcp_id);

                let removed = processes.remove(mcp_id);
                drop(processes);

                if let Some(mut proc) = removed {
                    let _ = proc.child.kill().await;
                    let _ = proc.child.wait().await; // REAP ZOMBIE
                }

                return Err(McpClientError::Timeout);
            }
        };

        if bytes_read == 0 {
            // EOF - process died unexpectedly, reap zombie
            tracing::error!("Process {} died (EOF)", mcp_id);

            let removed = processes.remove(mcp_id);
            drop(processes);

            if let Some(mut proc) = removed {
                let _ = proc.child.wait().await; // REAP ZOMBIE
            }

            return Err(McpClientError::InvalidResponse);
        }

        // Parse response
        let response: JsonRpcResponse = serde_json::from_str(&response_line)?;
        Ok(response)
    }

    /// Initialize connection to an upstream MCP
    pub async fn initialize(
        &self,
        transport: &McpTransport,
        mcp_id: &str,
    ) -> McpResult<InitializeResult> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(JsonRpcId::Number(0)),
            method: "initialize".to_string(),
            params: Some(serde_json::to_value(InitializeParams {
                protocol_version: "2024-11-05".to_string(),
                capabilities: Capabilities::default(),
                client_info: ClientInfo {
                    name: "PlexMCP".to_string(),
                    version: env!("CARGO_PKG_VERSION").to_string(),
                },
            })?),
        };

        let response = self.send_request(transport, mcp_id, &request).await?;

        if let Some(error) = response.error {
            return Err(McpClientError::McpError(error.message));
        }

        let result: InitializeResult =
            serde_json::from_value(response.result.ok_or(McpClientError::InvalidResponse)?)?;

        // Send initialized notification
        let notification = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: None,
            method: "notifications/initialized".to_string(),
            params: None,
        };
        // Fire and forget for notification
        let _ = self.send_request(transport, mcp_id, &notification).await;

        Ok(result)
    }

    /// Send a request using the appropriate transport
    pub async fn send_request(
        &self,
        transport: &McpTransport,
        mcp_id: &str,
        request: &JsonRpcRequest,
    ) -> McpResult<JsonRpcResponse> {
        match transport {
            McpTransport::Http { endpoint_url, auth } => {
                self.send_http_request(endpoint_url, auth, request).await
            }
            McpTransport::Sse { endpoint_url, auth } => {
                // SSE uses same HTTP endpoint but may return SSE stream
                self.send_http_request(endpoint_url, auth, request).await
            }
            McpTransport::Stdio { command, args, env } => {
                // Ensure process is running
                {
                    let processes = self.stdio_processes.lock().await;
                    if !processes.contains_key(mcp_id) {
                        drop(processes);
                        self.init_stdio_process(mcp_id, command, args, env).await?;
                    }
                }
                self.send_stdio_request(mcp_id, request).await
            }
        }
    }

    /// Send request with circuit breaker protection
    ///
    /// Wraps send_request with circuit breaker pattern to prevent cascading failures.
    /// After repeated failures, the circuit opens and requests fail fast without
    /// attempting to contact the failing MCP.
    pub async fn send_request_with_breaker(
        &self,
        mcp_id: uuid::Uuid,
        transport: &McpTransport,
        mcp_id_str: &str,
        request: &JsonRpcRequest,
    ) -> McpResult<JsonRpcResponse> {
        use crate::mcp::circuit_breaker::CircuitBreakerError;

        // Clone for the closure
        let transport = transport.clone();
        let mcp_id_str = mcp_id_str.to_string();
        let request = request.clone();

        let result = self
            .circuit_breakers
            .call(mcp_id, || async {
                self.send_request(&transport, &mcp_id_str, &request).await
            })
            .await;

        match result {
            Ok(response) => Ok(response),
            Err(CircuitBreakerError::Rejected) => {
                tracing::warn!(mcp_id = %mcp_id, "Circuit breaker OPEN - request rejected");
                Err(McpClientError::McpError(
                    "Circuit breaker is OPEN (too many recent failures)".to_string(),
                ))
            }
            Err(CircuitBreakerError::Inner(err)) => Err(err),
        }
    }

    /// Send request with retry logic and circuit breaker protection
    ///
    /// Combines circuit breaker pattern with exponential backoff retry logic.
    /// Only retries on transient errors (network issues, timeouts).
    /// Permanent errors (invalid JSON, MCP errors) are not retried.
    pub async fn send_request_with_retry(
        &self,
        mcp_id: uuid::Uuid,
        transport: &McpTransport,
        mcp_id_str: &str,
        request: &JsonRpcRequest,
    ) -> McpResult<JsonRpcResponse> {
        use tokio_retry::strategy::{jitter, ExponentialBackoff};
        use tokio_retry::Retry;

        // Create exponential backoff strategy with jitter
        let retry_strategy = ExponentialBackoff::from_millis(RETRY_BASE_DELAY.as_millis() as u64)
            .max_delay(RETRY_MAX_DELAY)
            .take(MAX_RETRIES)
            .map(jitter);

        let transport = transport.clone();
        let mcp_id_str = mcp_id_str.to_string();
        let request = request.clone();

        Retry::spawn(retry_strategy, || async {
            let result = self
                .send_request_with_breaker(mcp_id, &transport, &mcp_id_str, &request)
                .await;

            match &result {
                Ok(_) => Ok(result),
                Err(e) if e.is_transient() => {
                    tracing::debug!(
                        mcp_id = %mcp_id,
                        error = %e,
                        "Transient error - will retry"
                    );
                    Err(result) // Return error to trigger retry
                }
                Err(e) => {
                    tracing::debug!(
                        mcp_id = %mcp_id,
                        error = %e,
                        "Permanent error - will not retry"
                    );
                    Ok(result) // Return error wrapped in Ok to stop retrying
                }
            }
        })
        .await
        .unwrap_or_else(|e| e) // Extract the inner result
    }

    /// Get tools from an upstream MCP
    pub async fn get_tools(&self, transport: &McpTransport, mcp_id: &str) -> McpResult<Vec<Tool>> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(JsonRpcId::Number(1)),
            method: "tools/list".to_string(),
            params: Some(serde_json::json!({})),
        };

        let response = self.send_request(transport, mcp_id, &request).await?;

        if let Some(error) = response.error {
            return Err(McpClientError::McpError(error.message));
        }

        let result: ToolsListResult =
            serde_json::from_value(response.result.ok_or(McpClientError::InvalidResponse)?)?;

        Ok(result.tools)
    }

    /// Call a tool on an upstream MCP
    pub async fn call_tool(
        &self,
        transport: &McpTransport,
        mcp_id: &str,
        tool_name: &str,
        arguments: Value,
    ) -> McpResult<ToolCallResult> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(JsonRpcId::Number(2)),
            method: "tools/call".to_string(),
            params: Some(serde_json::to_value(ToolCallParams {
                name: tool_name.to_string(),
                arguments,
            })?),
        };

        let response = self.send_request(transport, mcp_id, &request).await?;

        if let Some(error) = response.error {
            return Err(McpClientError::McpError(error.message));
        }

        let result: ToolCallResult =
            serde_json::from_value(response.result.ok_or(McpClientError::InvalidResponse)?)?;

        Ok(result)
    }

    /// Get resources from an upstream MCP
    pub async fn get_resources(
        &self,
        transport: &McpTransport,
        mcp_id: &str,
    ) -> McpResult<Vec<Resource>> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(JsonRpcId::Number(3)),
            method: "resources/list".to_string(),
            params: Some(serde_json::json!({})),
        };

        let response = self.send_request(transport, mcp_id, &request).await?;

        if let Some(error) = response.error {
            return Err(McpClientError::McpError(error.message));
        }

        let result: ResourcesListResult =
            serde_json::from_value(response.result.ok_or(McpClientError::InvalidResponse)?)?;

        Ok(result.resources)
    }

    /// Read a resource from an upstream MCP
    pub async fn read_resource(
        &self,
        transport: &McpTransport,
        mcp_id: &str,
        uri: &str,
    ) -> McpResult<ResourceReadResult> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(JsonRpcId::Number(4)),
            method: "resources/read".to_string(),
            params: Some(serde_json::to_value(ResourceReadParams {
                uri: uri.to_string(),
            })?),
        };

        let response = self.send_request(transport, mcp_id, &request).await?;

        if let Some(error) = response.error {
            return Err(McpClientError::McpError(error.message));
        }

        let result: ResourceReadResult =
            serde_json::from_value(response.result.ok_or(McpClientError::InvalidResponse)?)?;

        Ok(result)
    }

    /// Get prompts from an upstream MCP
    pub async fn get_prompts(
        &self,
        transport: &McpTransport,
        mcp_id: &str,
    ) -> McpResult<Vec<Prompt>> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(JsonRpcId::Number(5)),
            method: "prompts/list".to_string(),
            params: Some(serde_json::json!({})),
        };

        let response = self.send_request(transport, mcp_id, &request).await?;

        if let Some(error) = response.error {
            return Err(McpClientError::McpError(error.message));
        }

        let result: PromptsListResult =
            serde_json::from_value(response.result.ok_or(McpClientError::InvalidResponse)?)?;

        Ok(result.prompts)
    }

    /// Get a specific prompt from an upstream MCP
    pub async fn get_prompt(
        &self,
        transport: &McpTransport,
        mcp_id: &str,
        prompt_name: &str,
        arguments: Value,
    ) -> McpResult<PromptGetResult> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(JsonRpcId::Number(6)),
            method: "prompts/get".to_string(),
            params: Some(serde_json::to_value(PromptGetParams {
                name: prompt_name.to_string(),
                arguments,
            })?),
        };

        let response = self.send_request(transport, mcp_id, &request).await?;

        if let Some(error) = response.error {
            return Err(McpClientError::McpError(error.message));
        }

        let result: PromptGetResult =
            serde_json::from_value(response.result.ok_or(McpClientError::InvalidResponse)?)?;

        Ok(result)
    }

    // =========================================================================
    // Circuit Breaker Wrapped Methods
    // =========================================================================

    /// Get tools with circuit breaker and retry protection
    pub async fn get_tools_with_breaker(
        &self,
        mcp_id: uuid::Uuid,
        transport: &McpTransport,
        mcp_id_str: &str,
    ) -> McpResult<Vec<Tool>> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(JsonRpcId::Number(1)),
            method: "tools/list".to_string(),
            params: Some(serde_json::json!({})),
        };

        let response = self
            .send_request_with_retry(mcp_id, transport, mcp_id_str, &request)
            .await?;

        if let Some(error) = response.error {
            return Err(McpClientError::McpError(error.message));
        }

        let result: ToolsListResult =
            serde_json::from_value(response.result.ok_or(McpClientError::InvalidResponse)?)?;

        Ok(result.tools)
    }

    /// Get resources with circuit breaker and retry protection
    pub async fn get_resources_with_breaker(
        &self,
        mcp_id: uuid::Uuid,
        transport: &McpTransport,
        mcp_id_str: &str,
    ) -> McpResult<Vec<Resource>> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(JsonRpcId::Number(3)),
            method: "resources/list".to_string(),
            params: Some(serde_json::json!({})),
        };

        let response = self
            .send_request_with_retry(mcp_id, transport, mcp_id_str, &request)
            .await?;

        if let Some(error) = response.error {
            return Err(McpClientError::McpError(error.message));
        }

        let result: ResourcesListResult =
            serde_json::from_value(response.result.ok_or(McpClientError::InvalidResponse)?)?;

        Ok(result.resources)
    }

    /// Get prompts with circuit breaker and retry protection
    pub async fn get_prompts_with_breaker(
        &self,
        mcp_id: uuid::Uuid,
        transport: &McpTransport,
        mcp_id_str: &str,
    ) -> McpResult<Vec<Prompt>> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(JsonRpcId::Number(5)),
            method: "prompts/list".to_string(),
            params: Some(serde_json::json!({})),
        };

        let response = self
            .send_request_with_retry(mcp_id, transport, mcp_id_str, &request)
            .await?;

        if let Some(error) = response.error {
            return Err(McpClientError::McpError(error.message));
        }

        let result: PromptsListResult =
            serde_json::from_value(response.result.ok_or(McpClientError::InvalidResponse)?)?;

        Ok(result.prompts)
    }

    /// Gracefully shutdown all stdio processes
    pub async fn shutdown(&self) {
        let mut processes = self.stdio_processes.lock().await;
        let process_list: Vec<(String, StdioProcess)> = processes.drain().collect();
        drop(processes);

        for (mcp_id, mut process) in process_list {
            tracing::info!("Shutting down stdio process: {}", mcp_id);

            // Try graceful shutdown by closing stdin
            drop(process.stdin);

            // Wait up to 5 seconds for graceful exit
            match tokio::time::timeout(std::time::Duration::from_secs(5), process.child.wait())
                .await
            {
                Ok(Ok(status)) => {
                    tracing::info!("Process {} exited gracefully: {:?}", mcp_id, status);
                }
                Ok(Err(e)) => {
                    tracing::error!("Error waiting for process {}: {}", mcp_id, e);
                }
                Err(_) => {
                    // Timeout - force kill
                    tracing::warn!("Killing unresponsive process {}", mcp_id);
                    let _ = process.child.kill().await;
                    let _ = process.child.wait().await; // REAP ZOMBIE
                }
            }
        }

        tracing::info!("All stdio processes shut down");
    }

    /// Monitor HTTP session count (called periodically)
    ///
    /// Note: Currently logs session count. Full cleanup implementation
    /// (with timestamp tracking) is a planned enhancement.
    pub async fn cleanup_stale_sessions(&self) {
        let sessions = self.http_sessions.lock().await;
        let count = sessions.len();

        if count > 0 {
            tracing::debug!("Active HTTP sessions: {}", count);
        }
    }
}

impl Default for McpClient {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for McpClient {
    fn drop(&mut self) {
        // Note: Can't do async cleanup in drop - use shutdown() method explicitly
        // Processes are cleaned up on errors and via shutdown() during graceful shutdown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_client_creation() {
        let client = McpClient::new();
        assert!(client.stdio_processes.try_lock().is_ok());
    }

    #[test]
    fn test_auth_none() {
        let auth = McpAuth::None;
        matches!(auth, McpAuth::None);
    }

    #[test]
    fn test_auth_bearer() {
        let auth = McpAuth::Bearer {
            token: "test-token".to_string(),
        };
        matches!(auth, McpAuth::Bearer { .. });
    }
}
