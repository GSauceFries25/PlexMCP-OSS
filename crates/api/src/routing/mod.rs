//! Host-based routing for MCP proxy
//!
//! This module handles resolving incoming Host headers to organizations,
//! enabling org-specific URLs like:
//! - Auto subdomains: swift-cloud-742.plexmcp.com
//! - Custom subdomains: acme.plexmcp.com
//! - Custom domains: mcp.company.com

mod cache;
mod host_resolver;

pub use cache::DomainCache;
pub use host_resolver::{
    HostResolveError, HostResolver, ResolutionType, ResolvedOrg, RESERVED_SUBDOMAINS,
};
