//! Host-to-Organization Resolution
//!
//! Resolves incoming Host headers to organization IDs for MCP routing.
//! Supports:
//! - Auto subdomains: swift-cloud-742.plexmcp.com -> org lookup by auto_subdomain
//! - Custom subdomains: acme.plexmcp.com -> org lookup by custom_subdomain
//! - Custom domains: mcp.company.com -> org lookup via custom_domains table

use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

use super::DomainCache;

/// Reserved subdomains that cannot be used by organizations
pub const RESERVED_SUBDOMAINS: &[&str] = &[
    "api",
    "www",
    "admin",
    "mail",
    "app",
    "dashboard",
    "console",
    "portal",
    "docs",
    "help",
    "support",
    "status",
    "blog",
    "cdn",
    "static",
    "assets",
    "media",
    "images",
    "staging",
    "dev",
    "test",
    "demo",
];

/// Result of resolving a host to an organization
#[derive(Debug, Clone)]
pub struct ResolvedOrg {
    /// The organization ID
    pub org_id: Uuid,
    /// The type of resolution that matched
    pub resolution_type: ResolutionType,
}

/// How the host was resolved
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolutionType {
    /// Matched auto-generated subdomain (e.g., swift-cloud-742.plexmcp.com)
    AutoSubdomain,
    /// Matched custom subdomain (e.g., acme.plexmcp.com)
    CustomSubdomain,
    /// Matched custom domain (e.g., mcp.company.com)
    CustomDomain,
}

/// Host resolver with caching
#[derive(Clone)]
pub struct HostResolver {
    pool: PgPool,
    cache: Arc<DomainCache>,
    base_domain: String,
}

impl HostResolver {
    /// Create a new host resolver
    pub fn new(pool: PgPool, base_domain: String) -> Self {
        Self {
            pool,
            cache: Arc::new(DomainCache::new()),
            base_domain,
        }
    }

    /// Create a new host resolver with custom cache
    pub fn with_cache(pool: PgPool, base_domain: String, cache: Arc<DomainCache>) -> Self {
        Self {
            pool,
            cache,
            base_domain,
        }
    }

    /// Resolve a host header to an organization
    ///
    /// Returns:
    /// - Ok(Some(ResolvedOrg)) if the host resolved to an org
    /// - Ok(None) if this is the API host (legacy mode, use API key only)
    /// - Err if the host doesn't resolve to any org
    pub async fn resolve(&self, host: &str) -> Result<Option<ResolvedOrg>, HostResolveError> {
        let host = normalize_host(host);

        // Check if this is the API host (legacy mode)
        if is_api_host(&host, &self.base_domain) {
            return Ok(None);
        }

        // Check cache first
        if let Some(cached_org_id) = self.cache.get(&host) {
            return match cached_org_id {
                Some(org_id) => Ok(Some(ResolvedOrg {
                    org_id,
                    // We don't cache the resolution type, but that's fine
                    // since it's only used for logging/debugging
                    resolution_type: ResolutionType::AutoSubdomain,
                })),
                None => Err(HostResolveError::NotFound(host.to_string())),
            };
        }

        // Check if this is a subdomain of our base domain
        let base_suffix = format!(".{}", self.base_domain);
        if host.ends_with(&base_suffix) {
            let subdomain = host.strip_suffix(&base_suffix).unwrap_or(&host);

            // Check for reserved subdomains
            if RESERVED_SUBDOMAINS.contains(&subdomain) {
                self.cache.set(&host, None);
                return Err(HostResolveError::ReservedSubdomain(subdomain.to_string()));
            }

            // Try auto subdomain first (format: word-word-000)
            if is_auto_subdomain_format(subdomain) {
                if let Some(resolved) = self.resolve_auto_subdomain(subdomain).await? {
                    self.cache.set(&host, Some(resolved.org_id));
                    return Ok(Some(resolved));
                }
            }

            // Try custom subdomain
            if let Some(resolved) = self.resolve_custom_subdomain(subdomain).await? {
                self.cache.set(&host, Some(resolved.org_id));
                return Ok(Some(resolved));
            }

            // Subdomain not found
            self.cache.set(&host, None);
            return Err(HostResolveError::NotFound(host.to_string()));
        }

        // Custom domain lookup
        if let Some(resolved) = self.resolve_custom_domain(&host).await? {
            self.cache.set(&host, Some(resolved.org_id));
            return Ok(Some(resolved));
        }

        // Domain not found
        self.cache.set(&host, None);
        Err(HostResolveError::NotFound(host.to_string()))
    }

    /// Resolve an auto-generated subdomain to an org
    async fn resolve_auto_subdomain(
        &self,
        subdomain: &str,
    ) -> Result<Option<ResolvedOrg>, HostResolveError> {
        #[derive(sqlx::FromRow)]
        struct OrgRow {
            id: Uuid,
        }

        let result: Option<OrgRow> = sqlx::query_as(
            "SELECT id FROM organizations WHERE auto_subdomain = $1 AND status = 'active'",
        )
        .bind(subdomain)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| HostResolveError::DatabaseError(e.to_string()))?;

        Ok(result.map(|row| ResolvedOrg {
            org_id: row.id,
            resolution_type: ResolutionType::AutoSubdomain,
        }))
    }

    /// Resolve a custom subdomain to an org
    async fn resolve_custom_subdomain(
        &self,
        subdomain: &str,
    ) -> Result<Option<ResolvedOrg>, HostResolveError> {
        #[derive(sqlx::FromRow)]
        struct OrgRow {
            id: Uuid,
        }

        let result: Option<OrgRow> = sqlx::query_as(
            "SELECT id FROM organizations WHERE custom_subdomain = $1 AND status = 'active'",
        )
        .bind(subdomain)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| HostResolveError::DatabaseError(e.to_string()))?;

        Ok(result.map(|row| ResolvedOrg {
            org_id: row.id,
            resolution_type: ResolutionType::CustomSubdomain,
        }))
    }

    /// Resolve a custom domain to an org
    async fn resolve_custom_domain(
        &self,
        domain: &str,
    ) -> Result<Option<ResolvedOrg>, HostResolveError> {
        #[derive(sqlx::FromRow)]
        struct DomainRow {
            org_id: Uuid,
        }

        // Custom domains are linked to users, join to get org_id
        // Only match if verification and SSL are both active
        let result: Option<DomainRow> = sqlx::query_as(
            r#"
            SELECT u.org_id
            FROM custom_domains cd
            JOIN users u ON cd.user_id = u.id
            WHERE cd.domain = $1
              AND cd.verification_status = 'active'
              AND cd.ssl_status = 'active'
            "#,
        )
        .bind(domain)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| HostResolveError::DatabaseError(e.to_string()))?;

        Ok(result.map(|row| ResolvedOrg {
            org_id: row.org_id,
            resolution_type: ResolutionType::CustomDomain,
        }))
    }

    /// Invalidate cache for a specific host
    pub fn invalidate_host(&self, host: &str) {
        let host = normalize_host(host);
        self.cache.invalidate(&host);
    }

    /// Invalidate all cached entries for an organization
    pub fn invalidate_org(&self, org_id: Uuid) {
        self.cache.invalidate_org(org_id);
    }

    /// Get the domain cache for statistics/management
    pub fn cache(&self) -> &DomainCache {
        &self.cache
    }
}

/// Normalize a host header value
fn normalize_host(host: &str) -> String {
    // Remove port if present
    let host = host.split(':').next().unwrap_or(host);
    // Lowercase
    host.to_lowercase()
}

/// Check if this is the API host (legacy endpoint)
fn is_api_host(host: &str, base_domain: &str) -> bool {
    host == format!("api.{}", base_domain) || host == base_domain
}

/// Check if a subdomain matches the auto-generated format (word-word-000)
fn is_auto_subdomain_format(subdomain: &str) -> bool {
    let parts: Vec<&str> = subdomain.split('-').collect();
    if parts.len() != 3 {
        return false;
    }

    // Check that the last part is a 3-digit number
    let num_part = parts[2];
    if num_part.len() != 3 {
        return false;
    }

    num_part.chars().all(|c| c.is_ascii_digit())
}

/// Errors that can occur during host resolution
#[derive(Debug, thiserror::Error)]
pub enum HostResolveError {
    #[error("Host not found: {0}")]
    NotFound(String),

    #[error("Reserved subdomain: {0}")]
    ReservedSubdomain(String),

    #[error("Database error: {0}")]
    DatabaseError(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_host() {
        assert_eq!(normalize_host("Example.COM"), "example.com");
        assert_eq!(normalize_host("example.com:8080"), "example.com");
        assert_eq!(normalize_host("EXAMPLE.COM:443"), "example.com");
    }

    #[test]
    fn test_is_api_host() {
        assert!(is_api_host("api.plexmcp.com", "plexmcp.com"));
        assert!(is_api_host("plexmcp.com", "plexmcp.com"));
        assert!(!is_api_host("acme.plexmcp.com", "plexmcp.com"));
        assert!(!is_api_host("swift-cloud-742.plexmcp.com", "plexmcp.com"));
    }

    #[test]
    fn test_is_auto_subdomain_format() {
        // Valid formats
        assert!(is_auto_subdomain_format("swift-cloud-742"));
        assert!(is_auto_subdomain_format("bright-falcon-000"));
        assert!(is_auto_subdomain_format("deep-cliff-999"));

        // Invalid formats
        assert!(!is_auto_subdomain_format("acme"));
        assert!(!is_auto_subdomain_format("swift-cloud"));
        assert!(!is_auto_subdomain_format("swift-cloud-74")); // 2 digits
        assert!(!is_auto_subdomain_format("swift-cloud-7420")); // 4 digits
        assert!(!is_auto_subdomain_format("swift-cloud-abc"));
        assert!(!is_auto_subdomain_format("a-b-c-d-123"));
    }

    #[test]
    fn test_reserved_subdomains() {
        assert!(RESERVED_SUBDOMAINS.contains(&"api"));
        assert!(RESERVED_SUBDOMAINS.contains(&"www"));
        assert!(RESERVED_SUBDOMAINS.contains(&"admin"));
        assert!(!RESERVED_SUBDOMAINS.contains(&"acme"));
        assert!(!RESERVED_SUBDOMAINS.contains(&"swift-cloud-742"));
    }
}
