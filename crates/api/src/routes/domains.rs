//! Custom domain routes for the Custom Domain addon
//!
//! These routes allow users to manage custom domains
//! (e.g., mcp.company.com) instead of the default subdomain.

use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::str::FromStr;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{auth::AuthUser, error::ApiError, state::AppState};
#[cfg(feature = "billing")]
use plexmcp_billing::addons::AddonType;

// ============================================================================
// Types
// ============================================================================

/// Domain status values (stored as TEXT in PostgreSQL to avoid SQLx enum issues)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DomainStatus {
    #[default]
    Pending,
    Verifying,
    Verified,
    Active,
    Failed,
    Expired,
}

impl FromStr for DomainStatus {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(DomainStatus::Pending),
            "verifying" => Ok(DomainStatus::Verifying),
            "verified" => Ok(DomainStatus::Verified),
            "active" => Ok(DomainStatus::Active),
            "failed" => Ok(DomainStatus::Failed),
            "expired" => Ok(DomainStatus::Expired),
            _ => Ok(DomainStatus::Pending),
        }
    }
}

/// Database row for custom domain (uses String for status to avoid SQLx enum issues)
#[derive(Debug, sqlx::FromRow)]
struct CustomDomainRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub domain: String,
    pub subdomain: Option<String>,
    pub verification_token: String,
    pub verification_status: String,
    pub verification_attempts: i32,
    pub last_verification_at: Option<OffsetDateTime>,
    pub verified_at: Option<OffsetDateTime>,
    pub ssl_status: String,
    pub ssl_provisioned_at: Option<OffsetDateTime>,
    pub ssl_expires_at: Option<OffsetDateTime>,
    pub cname_target: String,
    pub is_active: bool,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

/// API response for custom domain
#[derive(Debug, Serialize)]
pub struct CustomDomain {
    pub id: Uuid,
    pub user_id: Uuid,
    pub domain: String,
    pub subdomain: Option<String>,
    pub verification_token: String,
    pub verification_status: DomainStatus,
    pub verification_attempts: i32,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_verification_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub verified_at: Option<OffsetDateTime>,
    pub ssl_status: DomainStatus,
    #[serde(with = "time::serde::rfc3339::option")]
    pub ssl_provisioned_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub ssl_expires_at: Option<OffsetDateTime>,
    pub cname_target: String,
    pub txt_record_name: String,
    pub is_active: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

impl From<CustomDomainRow> for CustomDomain {
    fn from(row: CustomDomainRow) -> Self {
        let txt_record_name = format!("_plexmcp-verification.{}", row.domain);
        Self {
            id: row.id,
            user_id: row.user_id,
            domain: row.domain,
            subdomain: row.subdomain,
            verification_token: row.verification_token,
            verification_status: row.verification_status.parse().unwrap_or_default(),
            verification_attempts: row.verification_attempts,
            last_verification_at: row.last_verification_at,
            verified_at: row.verified_at,
            ssl_status: row.ssl_status.parse().unwrap_or_default(),
            ssl_provisioned_at: row.ssl_provisioned_at,
            ssl_expires_at: row.ssl_expires_at,
            cname_target: row.cname_target,
            txt_record_name,
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateDomainRequest {
    /// The custom domain (e.g., "mcp.company.com")
    pub domain: String,
}

#[derive(Debug, Serialize)]
pub struct CreateDomainResponse {
    pub domain: CustomDomain,
    /// Instructions for setting up DNS records
    pub dns_instructions: DnsInstructions,
}

#[derive(Debug, Serialize)]
pub struct DnsInstructions {
    pub cname: DnsRecord,
    pub txt: DnsRecord,
}

#[derive(Debug, Serialize)]
pub struct DnsRecord {
    pub record_type: String,
    pub name: String,
    pub value: String,
    pub ttl: u32,
}

#[derive(Debug, Serialize)]
pub struct ListDomainsResponse {
    pub domains: Vec<CustomDomain>,
}

#[derive(Debug, Serialize)]
pub struct VerifyDomainResponse {
    pub domain: CustomDomain,
    pub verification_result: VerificationResult,
}

#[derive(Debug, Serialize)]
pub struct VerificationResult {
    pub success: bool,
    pub cname_valid: bool,
    pub txt_valid: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct ToggleDomainRequest {
    pub is_active: bool,
}

// ============================================================================
// Route handlers
// ============================================================================

/// List all custom domains for the user
pub async fn list_domains(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<ListDomainsResponse>, ApiError> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    let rows = sqlx::query_as!(
        CustomDomainRow,
        r#"
        SELECT
            id,
            user_id,
            domain,
            subdomain,
            verification_token,
            verification_status::TEXT as "verification_status!",
            verification_attempts,
            last_verification_at,
            verified_at,
            ssl_status::TEXT as "ssl_status!",
            ssl_provisioned_at,
            ssl_expires_at,
            cname_target,
            is_active,
            created_at,
            updated_at
        FROM custom_domains
        WHERE user_id = $1
        ORDER BY created_at DESC
        "#,
        user_id
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(ListDomainsResponse {
        domains: rows.into_iter().map(|r| r.into()).collect(),
    }))
}

/// Add a new custom domain
pub async fn create_domain(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateDomainRequest>,
) -> Result<(StatusCode, Json<CreateDomainResponse>), ApiError> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Check if the custom_domain addon is enabled (only when billing feature is enabled)
    #[cfg(feature = "billing")]
    {
        let addon_enabled = check_addon_enabled(&state.pool, user_id, AddonType::CustomDomain).await?;
        if !addon_enabled {
            return Err(ApiError::Forbidden);
        }
    }

    // Validate domain format
    let domain = req.domain.trim().to_lowercase();
    if !is_valid_domain(&domain) {
        return Err(ApiError::BadRequest(
            "Invalid domain format. Please enter a valid domain like 'mcp.yourcompany.com'".to_string(),
        ));
    }

    // Check if domain is already registered
    let existing = sqlx::query_scalar!(
        "SELECT id FROM custom_domains WHERE domain = $1",
        domain
    )
    .fetch_optional(&state.pool)
    .await?;

    if existing.is_some() {
        return Err(ApiError::Conflict(
            "This domain is already registered".to_string(),
        ));
    }

    // Generate verification token
    let verification_token = generate_verification_token();

    // Insert the domain
    let row = sqlx::query_as!(
        CustomDomainRow,
        r#"
        INSERT INTO custom_domains (user_id, domain, verification_token)
        VALUES ($1, $2, $3)
        RETURNING
            id,
            user_id,
            domain,
            subdomain,
            verification_token,
            verification_status::TEXT as "verification_status!",
            verification_attempts,
            last_verification_at,
            verified_at,
            ssl_status::TEXT as "ssl_status!",
            ssl_provisioned_at,
            ssl_expires_at,
            cname_target,
            is_active,
            created_at,
            updated_at
        "#,
        user_id,
        domain,
        verification_token
    )
    .fetch_one(&state.pool)
    .await?;

    let domain_response: CustomDomain = row.into();
    let txt_record_name = domain_response.txt_record_name.clone();

    let dns_instructions = DnsInstructions {
        cname: DnsRecord {
            record_type: "CNAME".to_string(),
            name: domain_response.domain.clone(),
            value: domain_response.cname_target.clone(),
            ttl: 3600,
        },
        txt: DnsRecord {
            record_type: "TXT".to_string(),
            name: txt_record_name,
            value: format!("plexmcp-verify={}", domain_response.verification_token),
            ttl: 3600,
        },
    };

    Ok((
        StatusCode::CREATED,
        Json(CreateDomainResponse {
            domain: domain_response,
            dns_instructions,
        }),
    ))
}

/// Get a specific domain by ID
pub async fn get_domain(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(domain_id): Path<Uuid>,
) -> Result<Json<CustomDomain>, ApiError> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    let row = sqlx::query_as!(
        CustomDomainRow,
        r#"
        SELECT
            id,
            user_id,
            domain,
            subdomain,
            verification_token,
            verification_status::TEXT as "verification_status!",
            verification_attempts,
            last_verification_at,
            verified_at,
            ssl_status::TEXT as "ssl_status!",
            ssl_provisioned_at,
            ssl_expires_at,
            cname_target,
            is_active,
            created_at,
            updated_at
        FROM custom_domains
        WHERE id = $1 AND user_id = $2
        "#,
        domain_id,
        user_id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    Ok(Json(row.into()))
}

/// Trigger DNS verification for a domain
pub async fn verify_domain(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(domain_id): Path<Uuid>,
) -> Result<Json<VerifyDomainResponse>, ApiError> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    // Get the domain
    let row = sqlx::query_as!(
        CustomDomainRow,
        r#"
        SELECT
            id,
            user_id,
            domain,
            subdomain,
            verification_token,
            verification_status::TEXT as "verification_status!",
            verification_attempts,
            last_verification_at,
            verified_at,
            ssl_status::TEXT as "ssl_status!",
            ssl_provisioned_at,
            ssl_expires_at,
            cname_target,
            is_active,
            created_at,
            updated_at
        FROM custom_domains
        WHERE id = $1 AND user_id = $2
        "#,
        domain_id,
        user_id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    let domain: CustomDomain = row.into();
    let txt_record_name = domain.txt_record_name.clone();

    // Perform DNS verification
    let (cname_valid, txt_valid) = verify_dns_records(&domain.domain, &domain.cname_target, &domain.verification_token).await;
    let dns_success = cname_valid && txt_valid;

    // If DNS verification succeeded, provision SSL certificate via Fly.io
    let (ssl_provisioned, message) = if dns_success {
        match &state.fly_client {
            Some(fly_client) => {
                match fly_client.add_certificate(&domain.domain).await {
                    Ok(_cert_info) => {
                        tracing::info!("SSL certificate provisioned for {}", domain.domain);
                        (true, "DNS verification successful! SSL certificate has been provisioned.".to_string())
                    }
                    Err(e) => {
                        tracing::error!("Failed to provision SSL for {}: {}", domain.domain, e);
                        // DNS is valid but SSL failed - still mark DNS as verified
                        (false, format!("DNS verification successful, but SSL provisioning failed: {}. Please try again.", e))
                    }
                }
            }
            None => {
                tracing::warn!("Fly.io client not configured - SSL must be provisioned manually for {}", domain.domain);
                (false, "DNS verification successful! SSL certificate requires manual provisioning.".to_string())
            }
        }
    } else {
        let mut issues = Vec::new();
        if !cname_valid {
            issues.push(format!("CNAME record not found or incorrect. Expected {} -> {}", domain.domain, domain.cname_target));
        }
        if !txt_valid {
            issues.push(format!("TXT record not found. Expected {} with value plexmcp-verify={}", txt_record_name, domain.verification_token));
        }
        (false, issues.join(". "))
    };

    // Update verification status
    // ssl_status is only set to 'active' if both DNS verification AND SSL provisioning succeeded
    let updated_row = sqlx::query_as!(
        CustomDomainRow,
        r#"
        UPDATE custom_domains
        SET
            verification_status = CASE WHEN $3 THEN 'active'::domain_status ELSE 'failed'::domain_status END,
            ssl_status = CASE WHEN $4 THEN 'active'::domain_status ELSE ssl_status END,
            ssl_provisioned_at = CASE WHEN $4 THEN NOW() ELSE ssl_provisioned_at END,
            verification_attempts = verification_attempts + 1,
            last_verification_at = NOW(),
            verified_at = CASE WHEN $3 THEN NOW() ELSE verified_at END,
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING
            id,
            user_id,
            domain,
            subdomain,
            verification_token,
            verification_status::TEXT as "verification_status!",
            verification_attempts,
            last_verification_at,
            verified_at,
            ssl_status::TEXT as "ssl_status!",
            ssl_provisioned_at,
            ssl_expires_at,
            cname_target,
            is_active,
            created_at,
            updated_at
        "#,
        domain_id,
        user_id,
        dns_success,
        ssl_provisioned
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(VerifyDomainResponse {
        domain: updated_row.into(),
        verification_result: VerificationResult {
            success: dns_success && ssl_provisioned,
            cname_valid,
            txt_valid,
            message,
        },
    }))
}

/// Delete a custom domain
pub async fn delete_domain(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(domain_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    let result = sqlx::query!(
        "DELETE FROM custom_domains WHERE id = $1 AND user_id = $2",
        domain_id,
        user_id
    )
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}

/// Toggle domain active state (enable/disable)
pub async fn toggle_domain(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(domain_id): Path<Uuid>,
    Json(req): Json<ToggleDomainRequest>,
) -> Result<Json<CustomDomain>, ApiError> {
    let user_id = auth_user.user_id.ok_or(ApiError::Unauthorized)?;

    let row = sqlx::query_as!(
        CustomDomainRow,
        r#"
        UPDATE custom_domains
        SET is_active = $3, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING
            id,
            user_id,
            domain,
            subdomain,
            verification_token,
            verification_status::TEXT as "verification_status!",
            verification_attempts,
            last_verification_at,
            verified_at,
            ssl_status::TEXT as "ssl_status!",
            ssl_provisioned_at,
            ssl_expires_at,
            cname_target,
            is_active,
            created_at,
            updated_at
        "#,
        domain_id,
        user_id,
        req.is_active
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(ApiError::NotFound)?;

    Ok(Json(row.into()))
}

// ============================================================================
// Helper functions
// ============================================================================

/// Check if an addon is enabled for the user (only available with billing feature)
#[cfg(feature = "billing")]
async fn check_addon_enabled(pool: &PgPool, user_id: Uuid, addon_type: AddonType) -> Result<bool, ApiError> {
    // Check subscription_addons table via user's org_id
    let result = sqlx::query_scalar!(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM subscription_addons sa
            WHERE sa.org_id = (
                SELECT u.org_id
                FROM users u
                WHERE u.id = $1
            )
            AND sa.addon_type = $2
            AND sa.status = 'active'
        ) as "exists!"
        "#,
        user_id,
        addon_type.as_str()
    )
    .fetch_one(pool)
    .await?;

    Ok(result)
}

/// Validate domain format
fn is_valid_domain(domain: &str) -> bool {
    // Basic validation - should have at least one dot, no spaces, alphanumeric + hyphen
    if domain.is_empty() || domain.len() > 253 {
        return false;
    }

    let parts: Vec<&str> = domain.split('.').collect();
    if parts.len() < 2 {
        return false;
    }

    for part in parts {
        if part.is_empty() || part.len() > 63 {
            return false;
        }
        if part.starts_with('-') || part.ends_with('-') {
            return false;
        }
        if !part.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return false;
        }
    }

    true
}

/// Generate a secure verification token
fn generate_verification_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let token: String = (0..32)
        .map(|_| {
            let idx = rng.gen_range(0..36);
            if idx < 10 {
                (b'0' + idx) as char
            } else {
                (b'a' + idx - 10) as char
            }
        })
        .collect();
    token
}

/// Verify DNS records for a domain
/// Returns (cname_valid, txt_valid)
async fn verify_dns_records(domain: &str, expected_cname: &str, verification_token: &str) -> (bool, bool) {
    use trust_dns_resolver::TokioAsyncResolver;
    use trust_dns_resolver::config::{ResolverConfig, ResolverOpts};
    use trust_dns_resolver::proto::rr::RecordType;
    use std::collections::HashSet;

    // Create resolver
    let resolver = TokioAsyncResolver::tokio(ResolverConfig::cloudflare(), ResolverOpts::default());

    // Check CNAME record using generic lookup
    let cname_valid = match resolver.lookup(domain, RecordType::CNAME).await {
        Ok(response) => {
            response.iter().any(|record| {
                if let Some(cname) = record.as_cname() {
                    let cname_str = cname.to_string();
                    // Remove trailing dot if present
                    let cname_clean = cname_str.trim_end_matches('.');
                    cname_clean.eq_ignore_ascii_case(expected_cname)
                } else {
                    false
                }
            })
        }
        Err(_) => false,
    };

    // If CNAME check failed, try A record check (for ALIAS/ANAME records on root domains)
    // ALIAS records resolve to A records that match the target's A records
    let routing_valid = if cname_valid {
        true
    } else {
        // Get A records for the domain
        let domain_ips: HashSet<String> = match resolver.lookup(domain, RecordType::A).await {
            Ok(response) => {
                response.iter().filter_map(|record| {
                    record.as_a().map(|a| a.to_string())
                }).collect()
            }
            Err(_) => HashSet::new(),
        };

        if domain_ips.is_empty() {
            false
        } else {
            // Get A records for the expected CNAME target
            let target_ips: HashSet<String> = match resolver.lookup(expected_cname, RecordType::A).await {
                Ok(response) => {
                    response.iter().filter_map(|record| {
                        record.as_a().map(|a| a.to_string())
                    }).collect()
                }
                Err(_) => HashSet::new(),
            };

            // Check if there's any overlap in IPs (ALIAS records should resolve to same IPs)
            !domain_ips.is_disjoint(&target_ips)
        }
    };

    // Check TXT record using generic lookup
    let txt_record_name = format!("_plexmcp-verification.{}", domain);
    let expected_txt = format!("plexmcp-verify={}", verification_token);
    let txt_valid = match resolver.lookup(&txt_record_name, RecordType::TXT).await {
        Ok(response) => {
            response.iter().any(|record| {
                if let Some(txt) = record.as_txt() {
                    txt.txt_data().iter().any(|data| {
                        String::from_utf8_lossy(data).eq(&expected_txt)
                    })
                } else {
                    false
                }
            })
        }
        Err(_) => false,
    };

    (routing_valid, txt_valid)
}
