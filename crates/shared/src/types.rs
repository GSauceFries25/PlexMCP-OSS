//! Common types used across PlexMCP

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

// =============================================================================
// ID Wrappers
// =============================================================================

/// Organization ID wrapper
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct OrgId(pub Uuid);

impl OrgId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for OrgId {
    fn default() -> Self {
        Self::new()
    }
}

impl From<Uuid> for OrgId {
    fn from(id: Uuid) -> Self {
        Self(id)
    }
}

/// User ID wrapper
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct UserId(pub Uuid);

impl UserId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for UserId {
    fn default() -> Self {
        Self::new()
    }
}

impl From<Uuid> for UserId {
    fn from(id: Uuid) -> Self {
        Self(id)
    }
}

/// API Key ID wrapper
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ApiKeyId(pub Uuid);

impl ApiKeyId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for ApiKeyId {
    fn default() -> Self {
        Self::new()
    }
}

impl From<Uuid> for ApiKeyId {
    fn from(id: Uuid) -> Self {
        Self(id)
    }
}

/// MCP Instance ID wrapper
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct McpInstanceId(pub Uuid);

impl McpInstanceId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for McpInstanceId {
    fn default() -> Self {
        Self::new()
    }
}

impl From<Uuid> for McpInstanceId {
    fn from(id: Uuid) -> Self {
        Self(id)
    }
}

// =============================================================================
// Self-Hosted Mode
// =============================================================================

/// Check if running in self-hosted mode (unlimited access)
/// Set PLEXMCP_SELF_HOSTED=true for self-hosted deployments
pub fn is_self_hosted() -> bool {
    std::env::var("PLEXMCP_SELF_HOSTED")
        .map(|v| v.to_lowercase() == "true" || v == "1")
        .unwrap_or(false)
}

// =============================================================================
// Enums
// =============================================================================

/// Subscription tier for billing
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "VARCHAR", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum SubscriptionTier {
    Free,
    Starter,
    Pro,
    Team,
    Enterprise,
}

impl Default for SubscriptionTier {
    fn default() -> Self {
        Self::Free
    }
}

impl SubscriptionTier {
    /// Monthly request limit for this tier
    /// Unified pricing: Free (1K) → Pro (50K) → Team (250K) → Enterprise (Unlimited)
    /// Self-hosted mode: Always unlimited
    pub fn monthly_requests(&self) -> u64 {
        if is_self_hosted() {
            return u64::MAX;
        }
        match self {
            Self::Free => 1_000,
            Self::Starter => 1_000, // Legacy tier - same as Free
            Self::Pro => 50_000,
            Self::Team => 250_000,
            Self::Enterprise => u64::MAX,
        }
    }

    /// Maximum MCPs allowed for this tier
    /// Unified pricing: Free (5) → Pro (20) → Team (50) → Enterprise (Unlimited)
    /// Self-hosted mode: Always unlimited
    pub fn max_mcps(&self) -> u32 {
        if is_self_hosted() {
            return u32::MAX;
        }
        match self {
            Self::Free => 5,
            Self::Starter => 5, // Legacy tier - same as Free
            Self::Pro => 20,
            Self::Team => 50,
            Self::Enterprise => u32::MAX,
        }
    }

    /// Maximum team members for this tier
    /// Unified pricing: Free (1) → Pro (5) → Team (Unlimited) → Enterprise (Unlimited)
    /// Self-hosted mode: Always unlimited
    pub fn max_team_members(&self) -> u32 {
        if is_self_hosted() {
            return u32::MAX;
        }
        match self {
            Self::Free => 1,
            Self::Starter => 1, // Legacy tier - same as Free
            Self::Pro => 5,
            Self::Team => u32::MAX,
            Self::Enterprise => u32::MAX,
        }
    }

    /// Maximum API keys (connections) for this tier
    /// Unified pricing: Free (5) → Pro (20) → Team (50) → Enterprise (Unlimited)
    /// Self-hosted mode: Always unlimited
    pub fn max_api_keys(&self) -> u32 {
        if is_self_hosted() {
            return u32::MAX;
        }
        match self {
            Self::Free => 5,
            Self::Starter => 5, // Legacy tier - same as Free
            Self::Pro => 20,
            Self::Team => 50,
            Self::Enterprise => u32::MAX,
        }
    }

    /// Overage rate per 1,000 requests in cents
    /// Free: No overages allowed (None)
    /// Get overage rate per 1K requests in cents
    ///
    /// Default rates:
    /// - Pro: $0.50/1K = 50 cents
    /// - Team: $0.25/1K = 25 cents
    /// - Enterprise: Custom (None - handled separately)
    ///
    /// Configurable via environment variables:
    /// - `OVERAGE_RATE_PRO_CENTS`: Pro tier rate (default: 50)
    /// - `OVERAGE_RATE_TEAM_CENTS`: Team tier rate (default: 25)
    pub fn overage_rate_per_1k_cents(&self) -> Option<i32> {
        match self {
            Self::Free | Self::Starter => None, // No overages for free/starter tier
            Self::Pro => {
                let rate = std::env::var("OVERAGE_RATE_PRO_CENTS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(50);
                Some(rate)
            }
            Self::Team => {
                let rate = std::env::var("OVERAGE_RATE_TEAM_CENTS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(25);
                Some(rate)
            }
            Self::Enterprise => None, // Custom pricing
        }
    }

    /// Whether custom domains are allowed (via add-on or tier inclusion)
    /// Pro gets custom domains included, Team/Enterprise too
    /// Self-hosted mode: Always allowed
    pub fn custom_domain_allowed(&self) -> bool {
        if is_self_hosted() {
            return true;
        }
        matches!(self, Self::Pro | Self::Team | Self::Enterprise)
    }

    /// Whether SSO is available
    /// Only Team and Enterprise tiers have SSO
    /// Self-hosted mode: Always allowed
    pub fn sso_allowed(&self) -> bool {
        if is_self_hosted() {
            return true;
        }
        matches!(self, Self::Team | Self::Enterprise)
    }

    /// Whether this tier includes all add-ons for free
    /// Self-hosted mode: Always true
    pub fn includes_all_addons(&self) -> bool {
        if is_self_hosted() {
            return true;
        }
        matches!(self, Self::Team | Self::Enterprise)
    }

    /// Whether this tier can purchase individual add-ons
    /// Free and Pro tiers can purchase add-ons to expand capabilities
    pub fn can_purchase_addons(&self) -> bool {
        matches!(self, Self::Free | Self::Starter | Self::Pro)
    }

    /// Monthly requests with add-on boosts applied
    /// Each ExtraRequests add-on adds 25,000 requests
    pub fn monthly_requests_with_addons(&self, extra_request_addons: u32) -> u64 {
        let base = self.monthly_requests();
        if base == u64::MAX {
            return base;
        }
        base + (extra_request_addons as u64 * 25_000)
    }

    /// Maximum MCPs with add-on boosts applied
    /// Each ExtraMcps add-on adds 5 MCPs
    pub fn max_mcps_with_addons(&self, extra_mcp_addons: u32) -> u32 {
        let base = self.max_mcps();
        if base == u32::MAX {
            return base;
        }
        base + (extra_mcp_addons * 5)
    }

    /// Maximum API keys with add-on boosts applied
    /// Each ExtraApiKeys add-on adds 5 API keys
    pub fn max_api_keys_with_addons(&self, extra_key_addons: u32) -> u32 {
        let base = self.max_api_keys();
        if base == u32::MAX {
            return base;
        }
        base + (extra_key_addons * 5)
    }

    /// Maximum team members with add-on boosts applied
    /// Each ExtraTeamMembers add-on adds 3 team members
    pub fn max_team_members_with_addons(&self, extra_member_addons: u32) -> u32 {
        let base = self.max_team_members();
        if base == u32::MAX {
            return base;
        }
        base + (extra_member_addons * 3)
    }

    /// Calculate effective limits by merging tier defaults with custom overrides
    /// Custom values (Some) override tier defaults, None uses tier default
    pub fn effective_limits(&self, custom: &CustomLimits) -> EffectiveLimits {
        let has_custom = !custom.is_empty();

        // Determine source: all custom, all tier, or mixed
        let source = if !has_custom {
            LimitSource::Tier
        } else if custom.max_mcps.is_some()
            && custom.max_api_keys.is_some()
            && custom.max_team_members.is_some()
            && custom.max_requests_monthly.is_some()
        {
            LimitSource::Custom
        } else {
            LimitSource::Mixed
        };

        EffectiveLimits {
            max_mcps: custom.max_mcps.unwrap_or_else(|| self.max_mcps()),
            max_api_keys: custom.max_api_keys.unwrap_or_else(|| self.max_api_keys()),
            max_team_members: custom
                .max_team_members
                .unwrap_or_else(|| self.max_team_members()),
            max_requests_monthly: custom
                .max_requests_monthly
                .unwrap_or_else(|| self.monthly_requests()),
            overage_rate_cents: custom
                .overage_rate_cents
                .or_else(|| self.overage_rate_per_1k_cents()),
            monthly_price_cents: custom.monthly_price_cents,
            source,
        }
    }
}

impl std::fmt::Display for SubscriptionTier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Free => write!(f, "free"),
            Self::Starter => write!(f, "starter"),
            Self::Pro => write!(f, "pro"),
            Self::Team => write!(f, "team"),
            Self::Enterprise => write!(f, "enterprise"),
        }
    }
}

impl std::str::FromStr for SubscriptionTier {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "free" => Ok(Self::Free),
            "starter" => Ok(Self::Starter),
            "pro" => Ok(Self::Pro),
            "team" => Ok(Self::Team),
            "enterprise" => Ok(Self::Enterprise),
            _ => Err(format!("Invalid subscription tier: {}", s)),
        }
    }
}

/// User role within an organization
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "VARCHAR", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Owner,
    Admin,
    Member,
    Viewer,
}

impl Default for UserRole {
    fn default() -> Self {
        Self::Member
    }
}

impl UserRole {
    /// Get the permission level for this role (higher = more permissions)
    /// Owner: 3, Admin: 2, Member: 1, Viewer: 0
    pub fn level(&self) -> u8 {
        match self {
            Self::Owner => 3,
            Self::Admin => 2,
            Self::Member => 1,
            Self::Viewer => 0,
        }
    }

    /// Check if this role can manage resources (create/edit/delete)
    /// Viewers cannot manage resources
    pub fn can_manage(&self) -> bool {
        self.level() >= 1
    }

    /// Check if this role can administer the organization
    /// Only Owner and Admin can administer
    pub fn can_administer(&self) -> bool {
        self.level() >= 2
    }

    /// Check if this role has owner privileges
    pub fn is_owner(&self) -> bool {
        matches!(self, Self::Owner)
    }

    /// Parse a role from string (case insensitive)
    pub fn from_str_lossy(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "owner" => Self::Owner,
            "admin" => Self::Admin,
            "member" => Self::Member,
            "viewer" => Self::Viewer,
            _ => Self::Member, // Default to member for unknown roles
        }
    }
}

/// Subscription status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "VARCHAR", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum SubscriptionStatus {
    Active,
    PastDue,
    Canceled,
    Unpaid,
    Trialing,
    Incomplete,
}

impl Default for SubscriptionStatus {
    fn default() -> Self {
        Self::Active
    }
}

/// MCP instance status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "VARCHAR", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum McpStatus {
    Active,
    Inactive,
    Error,
    Provisioning,
}

impl Default for McpStatus {
    fn default() -> Self {
        Self::Active
    }
}

/// Health check status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "VARCHAR", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum HealthStatus {
    Healthy,
    Unhealthy,
    Unknown,
}

impl Default for HealthStatus {
    fn default() -> Self {
        Self::Unknown
    }
}

/// Invoice status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "VARCHAR", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum InvoiceStatus {
    Draft,
    Open,
    Paid,
    Void,
    Uncollectible,
}

impl Default for InvoiceStatus {
    fn default() -> Self {
        Self::Draft
    }
}

/// Member status for team member limit enforcement
/// - Active: Full access to organization resources
/// - Suspended: Read-only access due to plan limits
/// - Pending: Invited but not yet accepted
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "VARCHAR", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum MemberStatus {
    Active,
    Suspended,
    Pending,
}

impl Default for MemberStatus {
    fn default() -> Self {
        Self::Active
    }
}

impl MemberStatus {
    /// Check if member has full access (can modify resources)
    pub fn has_full_access(&self) -> bool {
        matches!(self, Self::Active)
    }

    /// Check if member has read-only access
    pub fn is_read_only(&self) -> bool {
        matches!(self, Self::Suspended)
    }

    /// Check if member is pending invitation acceptance
    pub fn is_pending(&self) -> bool {
        matches!(self, Self::Pending)
    }
}

impl std::fmt::Display for MemberStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Active => write!(f, "active"),
            Self::Suspended => write!(f, "suspended"),
            Self::Pending => write!(f, "pending"),
        }
    }
}

impl std::str::FromStr for MemberStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "active" => Ok(Self::Active),
            "suspended" => Ok(Self::Suspended),
            "pending" => Ok(Self::Pending),
            _ => Err(format!("Invalid member status: {}", s)),
        }
    }
}

// =============================================================================
// Database Models
// =============================================================================

/// Organization (tenant) model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Organization {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub stripe_customer_id: Option<String>,
    pub subscription_tier: String,
    pub custom_domain: Option<String>,
    /// Auto-generated memorable subdomain (e.g., "swift-cloud-742")
    pub auto_subdomain: String,
    pub settings: serde_json::Value,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    // Custom enterprise limits (NULL = use tier default)
    #[sqlx(default)]
    pub custom_max_mcps: Option<i32>,
    #[sqlx(default)]
    pub custom_max_api_keys: Option<i32>,
    #[sqlx(default)]
    pub custom_max_team_members: Option<i32>,
    #[sqlx(default)]
    pub custom_max_requests_monthly: Option<i64>,
    #[sqlx(default)]
    pub custom_overage_rate_cents: Option<i32>,
    #[sqlx(default)]
    pub custom_monthly_price_cents: Option<i32>,
    #[sqlx(default)]
    pub custom_limits_notes: Option<String>,
    #[sqlx(default)]
    pub custom_limits_updated_at: Option<OffsetDateTime>,
    #[sqlx(default)]
    pub custom_limits_updated_by: Option<Uuid>,
}

impl Organization {
    /// Get custom limits as a CustomLimits struct
    pub fn custom_limits(&self) -> CustomLimits {
        CustomLimits {
            max_mcps: self.custom_max_mcps.map(|v| v as u32),
            max_api_keys: self.custom_max_api_keys.map(|v| v as u32),
            max_team_members: self.custom_max_team_members.map(|v| v as u32),
            max_requests_monthly: self.custom_max_requests_monthly.map(|v| v as u64),
            overage_rate_cents: self.custom_overage_rate_cents,
            monthly_price_cents: self.custom_monthly_price_cents,
        }
    }

    /// Get effective limits considering both tier and custom overrides
    pub fn effective_limits(&self) -> EffectiveLimits {
        let tier: SubscriptionTier = self.subscription_tier.parse().unwrap_or_default();
        tier.effective_limits(&self.custom_limits())
    }
}

// =============================================================================
// Custom Enterprise Limits
// =============================================================================

/// Custom limits that can be set for enterprise organizations
/// NULL values mean "use tier default"
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CustomLimits {
    pub max_mcps: Option<u32>,
    pub max_api_keys: Option<u32>,
    pub max_team_members: Option<u32>,
    pub max_requests_monthly: Option<u64>,
    pub overage_rate_cents: Option<i32>,
    pub monthly_price_cents: Option<i32>,
}

impl CustomLimits {
    /// Check if all custom limits are unset (using tier defaults)
    pub fn is_empty(&self) -> bool {
        self.max_mcps.is_none()
            && self.max_api_keys.is_none()
            && self.max_team_members.is_none()
            && self.max_requests_monthly.is_none()
            && self.overage_rate_cents.is_none()
            && self.monthly_price_cents.is_none()
    }
}

/// Source of a limit value
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LimitSource {
    /// Limit comes from the subscription tier
    Tier,
    /// Limit is custom-set by admin
    Custom,
    /// Mix of tier and custom limits
    Mixed,
}

/// Effective limits for an organization (tier + custom overrides)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EffectiveLimits {
    pub max_mcps: u32,
    pub max_api_keys: u32,
    pub max_team_members: u32,
    pub max_requests_monthly: u64,
    pub overage_rate_cents: Option<i32>,
    pub monthly_price_cents: Option<i32>,
    pub source: LimitSource,
}

/// User model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub org_id: Uuid,
    pub email: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub role: String,
    pub email_verified: bool,
    #[serde(skip_serializing)]
    pub email_verification_token: Option<String>,
    #[serde(skip_serializing)]
    pub password_reset_token: Option<String>,
    pub password_reset_expires_at: Option<OffsetDateTime>,
    pub last_login_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

/// API Key model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ApiKey {
    pub id: Uuid,
    pub org_id: Uuid,
    pub name: String,
    #[serde(skip_serializing)]
    pub key_hash: String,
    pub key_prefix: String,
    pub scopes: serde_json::Value,
    pub rate_limit_rpm: i32,
    pub expires_at: Option<OffsetDateTime>,
    pub last_used_at: Option<OffsetDateTime>,
    pub request_count: i64,
    pub created_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    /// MCP access control mode: 'all' (default), 'selected', or 'none'
    pub mcp_access_mode: String,
    /// When mcp_access_mode='selected', only these MCP IDs are accessible
    pub allowed_mcp_ids: Option<Vec<Uuid>>,
}

/// MCP Instance model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct McpInstance {
    pub id: Uuid,
    pub org_id: Uuid,
    pub name: String,
    pub mcp_type: String,
    pub description: Option<String>,
    pub config: serde_json::Value,
    pub status: String,
    pub health_status: String,
    pub last_health_check_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    // Server info fields (populated during health checks)
    pub protocol_version: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tools_count: Option<i32>,
    pub resources_count: Option<i32>,
    pub last_latency_ms: Option<i32>,
    // Full tool/resource data (populated during health checks)
    pub tools_json: Option<serde_json::Value>,
    pub resources_json: Option<serde_json::Value>,
    // Timeout configuration (added in migration 20260102000002)
    // Note: Database uses INTEGER (i32), not BIGINT (i64)
    pub request_timeout_ms: i32,
    pub partial_timeout_ms: Option<i32>,
}

/// Subscription model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Subscription {
    pub id: Uuid,
    pub org_id: Uuid,
    pub stripe_subscription_id: Option<String>,
    pub stripe_price_id: Option<String>,
    pub status: String,
    pub current_period_start: Option<OffsetDateTime>,
    pub current_period_end: Option<OffsetDateTime>,
    pub cancel_at_period_end: bool,
    pub canceled_at: Option<OffsetDateTime>,
    pub trial_start: Option<OffsetDateTime>,
    pub trial_end: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

/// Invoice model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Invoice {
    pub id: Uuid,
    pub org_id: Uuid,
    pub stripe_invoice_id: Option<String>,
    pub amount_cents: i32,
    pub currency: String,
    pub status: String,
    pub description: Option<String>,
    pub due_date: Option<OffsetDateTime>,
    pub paid_at: Option<OffsetDateTime>,
    pub invoice_pdf_url: Option<String>,
    pub created_at: OffsetDateTime,
}

/// Usage record model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UsageRecord {
    pub id: Uuid,
    pub org_id: Uuid,
    pub api_key_id: Option<Uuid>,
    pub mcp_instance_id: Option<Uuid>,
    pub request_count: i32,
    pub token_count: i32,
    pub error_count: i32,
    pub latency_ms_avg: Option<i32>,
    pub period_start: OffsetDateTime,
    pub period_end: OffsetDateTime,
    pub created_at: OffsetDateTime,
}

/// Session model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Session {
    pub id: Uuid,
    pub user_id: Uuid,
    #[serde(skip_serializing)]
    pub refresh_token_hash: String,
    pub user_agent: Option<String>,
    pub ip_address: Option<String>,
    pub expires_at: OffsetDateTime,
    pub revoked_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

/// Invitation model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Invitation {
    pub id: Uuid,
    pub org_id: Uuid,
    pub email: String,
    pub role: String,
    #[serde(skip_serializing)]
    pub token: String,
    pub invited_by: Option<Uuid>,
    pub expires_at: OffsetDateTime,
    pub accepted_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

// =============================================================================
// API Request/Response Types
// =============================================================================

/// Create organization request
#[derive(Debug, Clone, Deserialize)]
pub struct CreateOrgRequest {
    pub name: String,
    pub slug: Option<String>,
}

/// Create user request (registration)
#[derive(Debug, Clone, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub org_name: String,
}

/// Login request
#[derive(Debug, Clone, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

/// Auth tokens response
#[derive(Debug, Clone, Serialize)]
pub struct AuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: i64,
}

/// Create API key request
#[derive(Debug, Clone, Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    pub scopes: Option<Vec<String>>,
    pub rate_limit_rpm: Option<i32>,
    pub expires_at: Option<OffsetDateTime>,
}

/// Create API key response (includes the raw key, only shown once)
#[derive(Debug, Clone, Serialize)]
pub struct CreateApiKeyResponse {
    pub id: Uuid,
    pub name: String,
    pub key: String, // Only returned on creation
    pub key_prefix: String,
    pub created_at: OffsetDateTime,
}

/// Create MCP instance request
#[derive(Debug, Clone, Deserialize)]
pub struct CreateMcpRequest {
    pub name: String,
    pub mcp_type: String,
    pub description: Option<String>,
    pub config: Option<serde_json::Value>,
    pub is_active: Option<bool>,
}

/// Invite user request
#[derive(Debug, Clone, Deserialize)]
pub struct InviteUserRequest {
    pub email: String,
    pub role: Option<String>,
}

/// Paginated response wrapper
#[derive(Debug, Clone, Serialize)]
pub struct PaginatedResponse<T> {
    pub data: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
    pub total_pages: i64,
}

impl<T> PaginatedResponse<T> {
    pub fn new(data: Vec<T>, total: i64, page: i64, per_page: i64) -> Self {
        let total_pages = (total + per_page - 1) / per_page;
        Self {
            data,
            total,
            page,
            per_page,
            total_pages,
        }
    }
}

/// Usage summary for billing
#[derive(Debug, Clone, Serialize)]
pub struct UsageSummary {
    pub org_id: Uuid,
    pub period_start: OffsetDateTime,
    pub period_end: OffsetDateTime,
    pub total_requests: i64,
    pub total_tokens: i64,
    pub total_errors: i64,
    pub requests_by_mcp: Vec<McpUsage>,
    pub requests_by_api_key: Vec<ApiKeyUsage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpUsage {
    pub mcp_id: Uuid,
    pub mcp_name: String,
    pub request_count: i64,
    pub token_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiKeyUsage {
    pub api_key_id: Uuid,
    pub api_key_name: String,
    pub request_count: i64,
}

// =============================================================================
// Add-on Access Control Helpers
// =============================================================================

/// Check if an organization can use custom branding (custom subdomain + custom domain)
///
/// Access rules:
/// - Team/Enterprise tiers: Always included
/// - Pro tier: Must have the custom_branding add-on enabled
/// - Free/Starter tiers: Not available
pub fn can_use_custom_branding(tier: SubscriptionTier, has_custom_branding_addon: bool) -> bool {
    tier.includes_all_addons() || (tier.can_purchase_addons() && has_custom_branding_addon)
}

/// Check if an organization can use priority support
///
/// Access rules:
/// - Team/Enterprise tiers: Always included
/// - Pro tier: Must have the priority_support add-on enabled
/// - Free/Starter tiers: Not available
pub fn can_use_priority_support(tier: SubscriptionTier, has_priority_support_addon: bool) -> bool {
    tier.includes_all_addons() || (tier.can_purchase_addons() && has_priority_support_addon)
}

/// Check if an organization can use extended retention
///
/// Access rules:
/// - Team/Enterprise tiers: Always included
/// - Pro tier: Must have the extended_retention add-on enabled
/// - Free/Starter tiers: Not available
pub fn can_use_extended_retention(
    tier: SubscriptionTier,
    has_extended_retention_addon: bool,
) -> bool {
    tier.includes_all_addons() || (tier.can_purchase_addons() && has_extended_retention_addon)
}

/// Get the retention period in days based on tier and add-ons
pub fn get_retention_days(tier: SubscriptionTier, has_extended_retention: bool) -> u32 {
    if can_use_extended_retention(tier, has_extended_retention) {
        365 // 1 year
    } else {
        match tier {
            SubscriptionTier::Free => 7,
            SubscriptionTier::Starter => 30,
            SubscriptionTier::Pro => 90,
            SubscriptionTier::Team | SubscriptionTier::Enterprise => 365,
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // SubscriptionTier Tests
    // =========================================================================

    #[test]
    fn test_subscription_tier_default() {
        assert_eq!(SubscriptionTier::default(), SubscriptionTier::Free);
    }

    #[test]
    fn test_subscription_tier_monthly_requests() {
        // Skip if self-hosted mode is enabled
        if is_self_hosted() {
            return;
        }
        assert_eq!(SubscriptionTier::Free.monthly_requests(), 1_000);
        assert_eq!(SubscriptionTier::Starter.monthly_requests(), 1_000); // Legacy
        assert_eq!(SubscriptionTier::Pro.monthly_requests(), 50_000);
        assert_eq!(SubscriptionTier::Team.monthly_requests(), 250_000);
        assert_eq!(SubscriptionTier::Enterprise.monthly_requests(), u64::MAX);
    }

    #[test]
    fn test_subscription_tier_max_mcps() {
        if is_self_hosted() {
            return;
        }
        assert_eq!(SubscriptionTier::Free.max_mcps(), 5);
        assert_eq!(SubscriptionTier::Pro.max_mcps(), 20);
        assert_eq!(SubscriptionTier::Team.max_mcps(), 50);
        assert_eq!(SubscriptionTier::Enterprise.max_mcps(), u32::MAX);
    }

    #[test]
    fn test_subscription_tier_max_team_members() {
        if is_self_hosted() {
            return;
        }
        assert_eq!(SubscriptionTier::Free.max_team_members(), 1);
        assert_eq!(SubscriptionTier::Pro.max_team_members(), 5);
        assert_eq!(SubscriptionTier::Team.max_team_members(), u32::MAX);
        assert_eq!(SubscriptionTier::Enterprise.max_team_members(), u32::MAX);
    }

    #[test]
    fn test_subscription_tier_max_api_keys() {
        if is_self_hosted() {
            return;
        }
        assert_eq!(SubscriptionTier::Free.max_api_keys(), 5);
        assert_eq!(SubscriptionTier::Pro.max_api_keys(), 20);
        assert_eq!(SubscriptionTier::Team.max_api_keys(), 50);
        assert_eq!(SubscriptionTier::Enterprise.max_api_keys(), u32::MAX);
    }

    #[test]
    fn test_subscription_tier_overage_rates() {
        // Test default rates (when env vars not set)
        assert_eq!(SubscriptionTier::Free.overage_rate_per_1k_cents(), None);
        assert_eq!(SubscriptionTier::Starter.overage_rate_per_1k_cents(), None);
        assert_eq!(
            SubscriptionTier::Enterprise.overage_rate_per_1k_cents(),
            None
        );

        // Pro and Team rates are configurable via env vars
        // Test defaults only when env vars are not set
        if std::env::var("OVERAGE_RATE_PRO_CENTS").is_err() {
            assert_eq!(SubscriptionTier::Pro.overage_rate_per_1k_cents(), Some(50));
        }
        if std::env::var("OVERAGE_RATE_TEAM_CENTS").is_err() {
            assert_eq!(SubscriptionTier::Team.overage_rate_per_1k_cents(), Some(25));
        }
    }

    #[test]
    fn test_subscription_tier_custom_domain() {
        if is_self_hosted() {
            return;
        }
        assert!(!SubscriptionTier::Free.custom_domain_allowed());
        assert!(!SubscriptionTier::Starter.custom_domain_allowed());
        assert!(SubscriptionTier::Pro.custom_domain_allowed());
        assert!(SubscriptionTier::Team.custom_domain_allowed());
        assert!(SubscriptionTier::Enterprise.custom_domain_allowed());
    }

    #[test]
    fn test_subscription_tier_sso() {
        if is_self_hosted() {
            return;
        }
        assert!(!SubscriptionTier::Free.sso_allowed());
        assert!(!SubscriptionTier::Starter.sso_allowed());
        assert!(!SubscriptionTier::Pro.sso_allowed());
        assert!(SubscriptionTier::Team.sso_allowed());
        assert!(SubscriptionTier::Enterprise.sso_allowed());
    }

    #[test]
    fn test_subscription_tier_includes_addons() {
        if is_self_hosted() {
            return;
        }
        assert!(!SubscriptionTier::Free.includes_all_addons());
        assert!(!SubscriptionTier::Pro.includes_all_addons());
        assert!(SubscriptionTier::Team.includes_all_addons());
        assert!(SubscriptionTier::Enterprise.includes_all_addons());
    }

    #[test]
    fn test_subscription_tier_can_purchase_addons() {
        assert!(SubscriptionTier::Free.can_purchase_addons());
        assert!(SubscriptionTier::Starter.can_purchase_addons());
        assert!(SubscriptionTier::Pro.can_purchase_addons());
        assert!(!SubscriptionTier::Team.can_purchase_addons());
        assert!(!SubscriptionTier::Enterprise.can_purchase_addons());
    }

    #[test]
    fn test_subscription_tier_addon_boosts() {
        if is_self_hosted() {
            return;
        }
        // Test request add-ons (25K each)
        assert_eq!(
            SubscriptionTier::Free.monthly_requests_with_addons(0),
            1_000
        );
        assert_eq!(
            SubscriptionTier::Free.monthly_requests_with_addons(1),
            26_000
        );
        assert_eq!(
            SubscriptionTier::Free.monthly_requests_with_addons(2),
            51_000
        );

        // Test MCP add-ons (5 each)
        assert_eq!(SubscriptionTier::Pro.max_mcps_with_addons(0), 20);
        assert_eq!(SubscriptionTier::Pro.max_mcps_with_addons(2), 30);

        // Test API key add-ons (5 each)
        assert_eq!(SubscriptionTier::Free.max_api_keys_with_addons(1), 10);

        // Test team member add-ons (3 each)
        assert_eq!(SubscriptionTier::Pro.max_team_members_with_addons(2), 11);

        // Enterprise tier should stay unlimited
        assert_eq!(
            SubscriptionTier::Enterprise.monthly_requests_with_addons(10),
            u64::MAX
        );
        assert_eq!(
            SubscriptionTier::Enterprise.max_mcps_with_addons(10),
            u32::MAX
        );
    }

    #[test]
    fn test_subscription_tier_display() {
        assert_eq!(format!("{}", SubscriptionTier::Free), "free");
        assert_eq!(format!("{}", SubscriptionTier::Starter), "starter");
        assert_eq!(format!("{}", SubscriptionTier::Pro), "pro");
        assert_eq!(format!("{}", SubscriptionTier::Team), "team");
        assert_eq!(format!("{}", SubscriptionTier::Enterprise), "enterprise");
    }

    #[test]
    fn test_subscription_tier_from_str() {
        assert_eq!(
            "free".parse::<SubscriptionTier>().unwrap(),
            SubscriptionTier::Free
        );
        assert_eq!(
            "FREE".parse::<SubscriptionTier>().unwrap(),
            SubscriptionTier::Free
        );
        assert_eq!(
            "Pro".parse::<SubscriptionTier>().unwrap(),
            SubscriptionTier::Pro
        );
        assert_eq!(
            "TEAM".parse::<SubscriptionTier>().unwrap(),
            SubscriptionTier::Team
        );
        assert!("invalid".parse::<SubscriptionTier>().is_err());
    }

    // =========================================================================
    // UserRole Tests
    // =========================================================================

    #[test]
    fn test_user_role_default() {
        assert_eq!(UserRole::default(), UserRole::Member);
    }

    #[test]
    fn test_user_role_levels() {
        assert_eq!(UserRole::Viewer.level(), 0);
        assert_eq!(UserRole::Member.level(), 1);
        assert_eq!(UserRole::Admin.level(), 2);
        assert_eq!(UserRole::Owner.level(), 3);
    }

    #[test]
    fn test_user_role_permissions() {
        // can_manage: Member and above
        assert!(!UserRole::Viewer.can_manage());
        assert!(UserRole::Member.can_manage());
        assert!(UserRole::Admin.can_manage());
        assert!(UserRole::Owner.can_manage());

        // can_administer: Admin and above
        assert!(!UserRole::Viewer.can_administer());
        assert!(!UserRole::Member.can_administer());
        assert!(UserRole::Admin.can_administer());
        assert!(UserRole::Owner.can_administer());

        // is_owner: Only Owner
        assert!(!UserRole::Viewer.is_owner());
        assert!(!UserRole::Admin.is_owner());
        assert!(UserRole::Owner.is_owner());
    }

    #[test]
    fn test_user_role_from_str_lossy() {
        assert_eq!(UserRole::from_str_lossy("owner"), UserRole::Owner);
        assert_eq!(UserRole::from_str_lossy("ADMIN"), UserRole::Admin);
        assert_eq!(UserRole::from_str_lossy("viewer"), UserRole::Viewer);
        assert_eq!(UserRole::from_str_lossy("unknown"), UserRole::Member); // Default
    }

    // =========================================================================
    // MemberStatus Tests
    // =========================================================================

    #[test]
    fn test_member_status_default() {
        assert_eq!(MemberStatus::default(), MemberStatus::Active);
    }

    #[test]
    fn test_member_status_access() {
        assert!(MemberStatus::Active.has_full_access());
        assert!(!MemberStatus::Suspended.has_full_access());
        assert!(!MemberStatus::Pending.has_full_access());

        assert!(!MemberStatus::Active.is_read_only());
        assert!(MemberStatus::Suspended.is_read_only());
        assert!(!MemberStatus::Pending.is_read_only());

        assert!(!MemberStatus::Active.is_pending());
        assert!(!MemberStatus::Suspended.is_pending());
        assert!(MemberStatus::Pending.is_pending());
    }

    #[test]
    fn test_member_status_display_and_parse() {
        assert_eq!(format!("{}", MemberStatus::Active), "active");
        assert_eq!(format!("{}", MemberStatus::Suspended), "suspended");
        assert_eq!(
            "active".parse::<MemberStatus>().unwrap(),
            MemberStatus::Active
        );
        assert!("invalid".parse::<MemberStatus>().is_err());
    }

    // =========================================================================
    // CustomLimits Tests
    // =========================================================================

    #[test]
    fn test_custom_limits_is_empty() {
        let empty = CustomLimits::default();
        assert!(empty.is_empty());

        let partial = CustomLimits {
            max_mcps: Some(100),
            ..Default::default()
        };
        assert!(!partial.is_empty());
    }

    #[test]
    fn test_effective_limits_from_tier() {
        if is_self_hosted() {
            return;
        }
        let custom = CustomLimits::default();
        let limits = SubscriptionTier::Pro.effective_limits(&custom);

        assert_eq!(limits.max_mcps, 20);
        assert_eq!(limits.max_api_keys, 20);
        assert_eq!(limits.max_team_members, 5);
        assert_eq!(limits.max_requests_monthly, 50_000);
        assert_eq!(limits.source, LimitSource::Tier);
    }

    #[test]
    fn test_effective_limits_with_custom() {
        if is_self_hosted() {
            return;
        }
        let custom = CustomLimits {
            max_mcps: Some(100),
            max_api_keys: Some(200),
            max_team_members: Some(50),
            max_requests_monthly: Some(1_000_000),
            overage_rate_cents: None,
            monthly_price_cents: None,
        };
        let limits = SubscriptionTier::Enterprise.effective_limits(&custom);

        assert_eq!(limits.max_mcps, 100);
        assert_eq!(limits.max_api_keys, 200);
        assert_eq!(limits.max_team_members, 50);
        assert_eq!(limits.max_requests_monthly, 1_000_000);
        assert_eq!(limits.source, LimitSource::Custom);
    }

    #[test]
    fn test_effective_limits_mixed() {
        if is_self_hosted() {
            return;
        }
        let custom = CustomLimits {
            max_mcps: Some(100),
            ..Default::default()
        };
        let limits = SubscriptionTier::Pro.effective_limits(&custom);

        assert_eq!(limits.max_mcps, 100); // Custom
        assert_eq!(limits.max_api_keys, 20); // Tier default
        assert_eq!(limits.source, LimitSource::Mixed);
    }

    // =========================================================================
    // Add-on Access Control Tests
    // =========================================================================

    #[test]
    fn test_custom_branding_access() {
        if is_self_hosted() {
            return;
        }
        // Team/Enterprise always have access
        assert!(can_use_custom_branding(SubscriptionTier::Team, false));
        assert!(can_use_custom_branding(SubscriptionTier::Enterprise, false));

        // Pro needs add-on
        assert!(!can_use_custom_branding(SubscriptionTier::Pro, false));
        assert!(can_use_custom_branding(SubscriptionTier::Pro, true));

        // Free cannot get it even with add-on flag (can_purchase returns true but needs actual purchase)
        assert!(!can_use_custom_branding(SubscriptionTier::Free, false));
    }

    #[test]
    fn test_retention_days() {
        if is_self_hosted() {
            return;
        }
        assert_eq!(get_retention_days(SubscriptionTier::Free, false), 7);
        assert_eq!(get_retention_days(SubscriptionTier::Starter, false), 30);
        assert_eq!(get_retention_days(SubscriptionTier::Pro, false), 90);
        assert_eq!(get_retention_days(SubscriptionTier::Team, false), 365);

        // With extended retention add-on
        assert_eq!(get_retention_days(SubscriptionTier::Pro, true), 365);
    }

    // =========================================================================
    // PaginatedResponse Tests
    // =========================================================================

    #[test]
    fn test_paginated_response() {
        let data = vec![1, 2, 3, 4, 5];
        let response = PaginatedResponse::new(data, 100, 1, 10);

        assert_eq!(response.total, 100);
        assert_eq!(response.page, 1);
        assert_eq!(response.per_page, 10);
        assert_eq!(response.total_pages, 10);
    }

    #[test]
    fn test_paginated_response_partial_page() {
        let data = vec![1, 2, 3];
        let response = PaginatedResponse::new(data, 23, 3, 10);

        // 23 items / 10 per page = 3 pages (2 full + 1 partial)
        assert_eq!(response.total_pages, 3);
    }

    // =========================================================================
    // ID Wrapper Tests
    // =========================================================================

    #[test]
    fn test_org_id_new() {
        let id1 = OrgId::new();
        let id2 = OrgId::new();
        assert_ne!(id1, id2); // Each new ID should be unique
    }

    #[test]
    fn test_user_id_from_uuid() {
        let uuid = Uuid::new_v4();
        let user_id: UserId = uuid.into();
        assert_eq!(user_id.0, uuid);
    }
}
