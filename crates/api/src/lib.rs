//! PlexMCP API Library
//!
//! This crate contains the API server components for PlexMCP.

pub mod alerting;
pub mod audit_constants;
pub mod auth;
pub mod config;
pub mod email;
pub mod error;
pub mod flyio;
pub mod mcp;
pub mod routes;
pub mod routing;
pub mod security;
pub mod state;
pub mod websocket;

pub use config::Config;
pub use error::{ApiError, ApiResult};
pub use routing::{DomainCache, HostResolver, ResolvedOrg};
pub use state::AppState;
