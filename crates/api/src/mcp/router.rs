//! MCP Request Router
//!
//! Handles routing of MCP requests to the correct upstream MCP based on
//! tool/resource namespacing.
//!
//! # Namespacing
//!
//! Tools are namespaced as `{mcp_name}:{tool_name}` (e.g., `github:create_issue`)
//! Resources are namespaced as `plexmcp://{mcp_name}/{original_uri}`

use std::collections::HashMap;

use super::types::*;

/// Parsed tool name with MCP prefix
#[derive(Debug, Clone)]
pub struct ParsedToolName {
    /// The MCP name prefix (e.g., "github")
    pub mcp_name: String,
    /// The original tool name (e.g., "create_issue")
    pub tool_name: String,
}

/// Parsed resource URI with MCP prefix
#[derive(Debug, Clone)]
pub struct ParsedResourceUri {
    /// The MCP name (e.g., "supabase")
    pub mcp_name: String,
    /// The original URI (e.g., "postgres://table/users")
    pub original_uri: String,
}

/// MCP Request Router
pub struct McpRouter {
    /// Separator used between MCP name and tool name
    tool_separator: char,
    /// URI scheme for PlexMCP resources
    resource_scheme: String,
}

impl McpRouter {
    /// Create a new router with default settings
    pub fn new() -> Self {
        Self {
            tool_separator: ':',
            resource_scheme: "plexmcp".to_string(),
        }
    }

    /// Create a prefixed tool name
    pub fn prefix_tool_name(&self, mcp_name: &str, tool_name: &str) -> String {
        format!("{}{}{}", mcp_name, self.tool_separator, tool_name)
    }

    /// Parse a prefixed tool name to extract MCP name and original tool name
    pub fn parse_tool_name(&self, prefixed_name: &str) -> Option<ParsedToolName> {
        let parts: Vec<&str> = prefixed_name.splitn(2, self.tool_separator).collect();
        if parts.len() == 2 {
            Some(ParsedToolName {
                mcp_name: parts[0].to_string(),
                tool_name: parts[1].to_string(),
            })
        } else {
            None
        }
    }

    /// Create a prefixed resource URI
    pub fn prefix_resource_uri(&self, mcp_name: &str, original_uri: &str) -> String {
        format!("{}://{}/{}", self.resource_scheme, mcp_name, original_uri)
    }

    /// Parse a prefixed resource URI
    pub fn parse_resource_uri(&self, prefixed_uri: &str) -> Option<ParsedResourceUri> {
        let prefix = format!("{}://", self.resource_scheme);
        if let Some(rest) = prefixed_uri.strip_prefix(&prefix) {
            let parts: Vec<&str> = rest.splitn(2, '/').collect();
            if parts.len() == 2 {
                return Some(ParsedResourceUri {
                    mcp_name: parts[0].to_string(),
                    original_uri: parts[1].to_string(),
                });
            }
        }
        None
    }

    /// Prefix all tools with MCP name
    pub fn prefix_tools(&self, mcp_name: &str, tools: Vec<Tool>) -> Vec<Tool> {
        tools
            .into_iter()
            .map(|mut tool| {
                tool.name = self.prefix_tool_name(mcp_name, &tool.name);
                // Optionally update description to indicate source
                if let Some(desc) = &tool.description {
                    tool.description = Some(format!("[{}] {}", mcp_name, desc));
                } else {
                    tool.description = Some(format!("[{}]", mcp_name));
                }
                tool
            })
            .collect()
    }

    /// Prefix all resources with MCP name
    pub fn prefix_resources(&self, mcp_name: &str, resources: Vec<Resource>) -> Vec<Resource> {
        resources
            .into_iter()
            .map(|mut resource| {
                resource.uri = self.prefix_resource_uri(mcp_name, &resource.uri);
                // Update description to indicate source
                if let Some(desc) = &resource.description {
                    resource.description = Some(format!("[{}] {}", mcp_name, desc));
                } else {
                    resource.description = Some(format!("[{}]", mcp_name));
                }
                resource
            })
            .collect()
    }

    /// Prefix all prompts with MCP name
    pub fn prefix_prompts(&self, mcp_name: &str, prompts: Vec<Prompt>) -> Vec<Prompt> {
        prompts
            .into_iter()
            .map(|mut prompt| {
                prompt.name = self.prefix_tool_name(mcp_name, &prompt.name);
                // Update description to indicate source
                if let Some(desc) = &prompt.description {
                    prompt.description = Some(format!("[{}] {}", mcp_name, desc));
                } else {
                    prompt.description = Some(format!("[{}]", mcp_name));
                }
                prompt
            })
            .collect()
    }

    /// Route a tools/call request to the correct MCP
    /// Returns (mcp_name, transport, original_tool_name)
    pub fn route_tool_call<'a>(
        &self,
        prefixed_tool_name: &str,
        mcps: &'a HashMap<String, McpTransport>,
    ) -> Option<(String, &'a McpTransport, String)> {
        let parsed = self.parse_tool_name(prefixed_tool_name)?;
        let transport = mcps.get(&parsed.mcp_name)?;
        Some((parsed.mcp_name, transport, parsed.tool_name))
    }

    /// Route a resources/read request to the correct MCP
    /// Returns (mcp_name, transport, original_uri)
    pub fn route_resource_read<'a>(
        &self,
        prefixed_uri: &str,
        mcps: &'a HashMap<String, McpTransport>,
    ) -> Option<(String, &'a McpTransport, String)> {
        let parsed = self.parse_resource_uri(prefixed_uri)?;
        let transport = mcps.get(&parsed.mcp_name)?;
        Some((parsed.mcp_name, transport, parsed.original_uri))
    }

    /// Determine which MCP method maps to
    pub fn get_method_type(method: &str) -> McpMethod {
        match method {
            "initialize" => McpMethod::Initialize,
            "notifications/initialized" => McpMethod::Notification,
            "tools/list" => McpMethod::ToolsList,
            "tools/call" => McpMethod::ToolsCall,
            "resources/list" => McpMethod::ResourcesList,
            "resources/read" => McpMethod::ResourcesRead,
            "resources/subscribe" => McpMethod::ResourcesSubscribe,
            "resources/unsubscribe" => McpMethod::ResourcesUnsubscribe,
            "prompts/list" => McpMethod::PromptsList,
            "prompts/get" => McpMethod::PromptsGet,
            "logging/setLevel" => McpMethod::LoggingSetLevel,
            "completion/complete" => McpMethod::CompletionComplete,
            _ => McpMethod::Unknown,
        }
    }
}

/// Types of MCP methods
#[derive(Debug, Clone, PartialEq)]
pub enum McpMethod {
    Initialize,
    Notification,
    ToolsList,
    ToolsCall,
    ResourcesList,
    ResourcesRead,
    ResourcesSubscribe,
    ResourcesUnsubscribe,
    PromptsList,
    PromptsGet,
    LoggingSetLevel,
    CompletionComplete,
    Unknown,
}

impl McpMethod {
    /// Does this method require routing to a specific MCP?
    pub fn requires_routing(&self) -> bool {
        matches!(
            self,
            McpMethod::ToolsCall | McpMethod::ResourcesRead | McpMethod::PromptsGet
        )
    }

    /// Does this method aggregate results from all MCPs?
    pub fn aggregates_results(&self) -> bool {
        matches!(
            self,
            McpMethod::ToolsList | McpMethod::ResourcesList | McpMethod::PromptsList
        )
    }

    /// Is this a proxy-handled method (not forwarded)?
    pub fn is_proxy_handled(&self) -> bool {
        matches!(self, McpMethod::Initialize | McpMethod::Notification)
    }
}

impl Default for McpRouter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prefix_tool_name() {
        let router = McpRouter::new();
        assert_eq!(
            router.prefix_tool_name("github", "create_issue"),
            "github:create_issue"
        );
    }

    #[test]
    fn test_parse_tool_name() {
        let router = McpRouter::new();
        let parsed = router.parse_tool_name("github:create_issue").unwrap();
        assert_eq!(parsed.mcp_name, "github");
        assert_eq!(parsed.tool_name, "create_issue");
    }

    #[test]
    fn test_parse_tool_name_with_colons() {
        let router = McpRouter::new();
        // Tool name can contain colons
        let parsed = router
            .parse_tool_name("github:api:v2:create_issue")
            .unwrap();
        assert_eq!(parsed.mcp_name, "github");
        assert_eq!(parsed.tool_name, "api:v2:create_issue");
    }

    #[test]
    fn test_parse_tool_name_no_prefix() {
        let router = McpRouter::new();
        assert!(router.parse_tool_name("create_issue").is_none());
    }

    #[test]
    fn test_prefix_resource_uri() {
        let router = McpRouter::new();
        assert_eq!(
            router.prefix_resource_uri("supabase", "postgres://users"),
            "plexmcp://supabase/postgres://users"
        );
    }

    #[test]
    fn test_parse_resource_uri() {
        let router = McpRouter::new();
        let parsed = router
            .parse_resource_uri("plexmcp://supabase/postgres://users")
            .unwrap();
        assert_eq!(parsed.mcp_name, "supabase");
        assert_eq!(parsed.original_uri, "postgres://users");
    }

    #[test]
    fn test_prefix_tools() {
        let router = McpRouter::new();
        let tools = vec![Tool {
            name: "create_issue".to_string(),
            description: Some("Create a new issue".to_string()),
            input_schema: serde_json::json!({}),
        }];

        let prefixed = router.prefix_tools("github", tools);
        assert_eq!(prefixed[0].name, "github:create_issue");
        assert!(prefixed[0]
            .description
            .as_ref()
            .unwrap()
            .contains("[github]"));
    }

    #[test]
    fn test_method_type() {
        assert_eq!(
            McpRouter::get_method_type("tools/list"),
            McpMethod::ToolsList
        );
        assert_eq!(
            McpRouter::get_method_type("tools/call"),
            McpMethod::ToolsCall
        );
        assert_eq!(
            McpRouter::get_method_type("unknown/method"),
            McpMethod::Unknown
        );
    }

    #[test]
    fn test_method_requires_routing() {
        assert!(McpMethod::ToolsCall.requires_routing());
        assert!(McpMethod::ResourcesRead.requires_routing());
        assert!(!McpMethod::ToolsList.requires_routing());
        assert!(!McpMethod::Initialize.requires_routing());
    }

    #[test]
    fn test_method_aggregates_results() {
        assert!(McpMethod::ToolsList.aggregates_results());
        assert!(McpMethod::ResourcesList.aggregates_results());
        assert!(!McpMethod::ToolsCall.aggregates_results());
        assert!(!McpMethod::Initialize.aggregates_results());
    }
}
