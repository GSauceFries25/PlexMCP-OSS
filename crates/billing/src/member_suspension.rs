//! Member Suspension Service
//!
//! Handles graceful degradation when organizations downgrade to plans with
//! fewer allowed team members. Excess members are set to read-only access.
//!
//! ## Key Features
//! - Suspends excess members (newest first, preserving owner)
//! - Provides read-only access for suspended members
//! - Allows owner to unsuspend members when slots are available

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::{BillingError, BillingResult};
use plexmcp_shared::types::SubscriptionTier;

/// Information about a member who will be suspended
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberToSuspend {
    pub member_id: Uuid,
    pub user_id: Uuid,
    pub email: String,
    pub role: String,
    pub joined_at: OffsetDateTime,
}

/// Result of a suspension operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuspensionResult {
    pub org_id: Uuid,
    pub suspended_count: u32,
    pub suspended_members: Vec<MemberToSuspend>,
    pub reason: String,
}

/// Summary of organization member status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberStatusSummary {
    pub org_id: Uuid,
    pub active_count: i64,
    pub suspended_count: i64,
    pub pending_count: i64,
    pub total_count: i64,
}

/// Information about affected members for downgrade preview
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AffectedMembersInfo {
    pub current_count: i64,
    pub new_limit: u32,
    pub excess_count: u32,
    pub members_to_suspend: Vec<MemberToSuspend>,
}

/// Member Suspension Service
pub struct MemberSuspensionService {
    pool: PgPool,
}

impl MemberSuspensionService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Get active member count for an organization (excludes suspended and pending)
    pub async fn get_active_member_count(&self, org_id: Uuid) -> BillingResult<i64> {
        let result: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM organization_members
            WHERE org_id = $1 AND status = 'active'
            "#,
        )
        .bind(org_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(result.0)
    }

    /// Get member status summary for an organization
    pub async fn get_member_status_summary(
        &self,
        org_id: Uuid,
    ) -> BillingResult<MemberStatusSummary> {
        let result: (i64, i64, i64, i64) = sqlx::query_as(
            r#"
            SELECT
                COUNT(*) FILTER (WHERE status = 'active') as active_count,
                COUNT(*) FILTER (WHERE status = 'suspended') as suspended_count,
                COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
                COUNT(*) as total_count
            FROM organization_members
            WHERE org_id = $1
            "#,
        )
        .bind(org_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(MemberStatusSummary {
            org_id,
            active_count: result.0,
            suspended_count: result.1,
            pending_count: result.2,
            total_count: result.3,
        })
    }

    /// Calculate which members would be suspended for a given member limit
    /// Returns members ordered by join date (newest first), excluding owner
    pub async fn calculate_members_to_suspend(
        &self,
        org_id: Uuid,
        new_limit: u32,
    ) -> BillingResult<Vec<MemberToSuspend>> {
        let active_count = self.get_active_member_count(org_id).await?;

        // No suspensions needed if under limit
        if active_count <= new_limit as i64 {
            return Ok(Vec::new());
        }

        let excess_count = active_count - new_limit as i64;

        // Get members ordered by created_at DESC (newest first), excluding owner
        // The owner should never be suspended
        let members: Vec<(Uuid, Uuid, String, String, OffsetDateTime)> = sqlx::query_as(
            r#"
            SELECT
                om.id,
                om.user_id,
                COALESCE(u.email, 'unknown@example.com') as email,
                om.role,
                om.created_at
            FROM organization_members om
            LEFT JOIN users u ON u.id = om.user_id
            WHERE om.org_id = $1
              AND om.status = 'active'
              AND om.role != 'owner'
            ORDER BY om.created_at DESC
            LIMIT $2
            "#,
        )
        .bind(org_id)
        .bind(excess_count)
        .fetch_all(&self.pool)
        .await?;

        let members_to_suspend: Vec<MemberToSuspend> = members
            .into_iter()
            .map(
                |(member_id, user_id, email, role, joined_at)| MemberToSuspend {
                    member_id,
                    user_id,
                    email,
                    role,
                    joined_at,
                },
            )
            .collect();

        Ok(members_to_suspend)
    }

    /// Get affected members info for a downgrade preview
    pub async fn get_affected_members_info(
        &self,
        org_id: Uuid,
        new_tier: &str,
    ) -> BillingResult<Option<AffectedMembersInfo>> {
        let tier: SubscriptionTier = new_tier
            .parse()
            .map_err(|e: String| BillingError::InvalidTier(e))?;

        let new_limit = tier.max_team_members();

        // Unlimited tiers don't need suspension
        if new_limit == u32::MAX {
            return Ok(None);
        }

        let active_count = self.get_active_member_count(org_id).await?;

        // No excess members
        if active_count <= new_limit as i64 {
            return Ok(None);
        }

        let excess_count = (active_count - new_limit as i64) as u32;
        let members_to_suspend = self.calculate_members_to_suspend(org_id, new_limit).await?;

        Ok(Some(AffectedMembersInfo {
            current_count: active_count,
            new_limit,
            excess_count,
            members_to_suspend,
        }))
    }

    /// Suspend excess members when a downgrade takes effect
    /// Suspends newest members first, preserving owner
    pub async fn suspend_excess_members(
        &self,
        org_id: Uuid,
        new_tier: &str,
        reason: &str,
    ) -> BillingResult<SuspensionResult> {
        let tier: SubscriptionTier = new_tier
            .parse()
            .map_err(|e: String| BillingError::InvalidTier(e))?;

        let new_limit = tier.max_team_members();

        // Unlimited tiers don't need suspension
        if new_limit == u32::MAX {
            return Ok(SuspensionResult {
                org_id,
                suspended_count: 0,
                suspended_members: Vec::new(),
                reason: reason.to_string(),
            });
        }

        let members_to_suspend = self.calculate_members_to_suspend(org_id, new_limit).await?;

        if members_to_suspend.is_empty() {
            return Ok(SuspensionResult {
                org_id,
                suspended_count: 0,
                suspended_members: Vec::new(),
                reason: reason.to_string(),
            });
        }

        // Suspend each member
        let member_ids: Vec<Uuid> = members_to_suspend.iter().map(|m| m.member_id).collect();

        sqlx::query(
            r#"
            UPDATE organization_members
            SET status = 'suspended',
                suspended_at = NOW(),
                suspended_reason = $1
            WHERE id = ANY($2)
            "#,
        )
        .bind(reason)
        .bind(&member_ids)
        .execute(&self.pool)
        .await?;

        let suspended_count = members_to_suspend.len() as u32;

        tracing::info!(
            org_id = %org_id,
            suspended_count = suspended_count,
            new_tier = new_tier,
            reason = reason,
            "Suspended excess members after downgrade"
        );

        Ok(SuspensionResult {
            org_id,
            suspended_count,
            suspended_members: members_to_suspend,
            reason: reason.to_string(),
        })
    }

    /// Unsuspend a specific member (owner action)
    pub async fn unsuspend_member(&self, org_id: Uuid, member_id: Uuid) -> BillingResult<()> {
        // First check if org has room for another active member
        let active_count = self.get_active_member_count(org_id).await?;

        // Get org's current tier and limit
        let tier_result: Option<(String,)> =
            sqlx::query_as("SELECT subscription_tier FROM organizations WHERE id = $1")
                .bind(org_id)
                .fetch_optional(&self.pool)
                .await?;

        let current_tier = tier_result
            .ok_or_else(|| BillingError::NotFound(format!("Organization not found: {}", org_id)))?
            .0;

        let tier: SubscriptionTier = current_tier.parse().unwrap_or(SubscriptionTier::Free);

        let limit = tier.max_team_members();

        // Check if there's room
        if limit != u32::MAX && active_count >= limit as i64 {
            return Err(BillingError::InvalidInput(format!(
                "Cannot unsuspend member: team limit reached ({}/{}). Upgrade plan or suspend another member.",
                active_count, limit
            )));
        }

        // Unsuspend the member
        let result = sqlx::query(
            r#"
            UPDATE organization_members
            SET status = 'active',
                suspended_at = NULL,
                suspended_reason = NULL
            WHERE id = $1 AND org_id = $2 AND status = 'suspended'
            "#,
        )
        .bind(member_id)
        .bind(org_id)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(BillingError::NotFound(format!(
                "Suspended member not found: {}",
                member_id
            )));
        }

        tracing::info!(
            org_id = %org_id,
            member_id = %member_id,
            "Unsuspended member"
        );

        Ok(())
    }

    /// Check if a member is suspended
    pub async fn is_member_suspended(&self, org_id: Uuid, user_id: Uuid) -> BillingResult<bool> {
        let result: Option<(String,)> = sqlx::query_as(
            r#"
            SELECT status
            FROM organization_members
            WHERE org_id = $1 AND user_id = $2
            "#,
        )
        .bind(org_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(matches!(result, Some((ref s,)) if s == "suspended"))
    }

    /// Get suspended members for an organization
    pub async fn get_suspended_members(&self, org_id: Uuid) -> BillingResult<Vec<MemberToSuspend>> {
        let members: Vec<(Uuid, Uuid, String, String, OffsetDateTime)> = sqlx::query_as(
            r#"
            SELECT
                om.id,
                om.user_id,
                COALESCE(u.email, 'unknown@example.com') as email,
                om.role,
                om.created_at
            FROM organization_members om
            LEFT JOIN users u ON u.id = om.user_id
            WHERE om.org_id = $1 AND om.status = 'suspended'
            ORDER BY om.suspended_at DESC
            "#,
        )
        .bind(org_id)
        .fetch_all(&self.pool)
        .await?;

        let suspended: Vec<MemberToSuspend> = members
            .into_iter()
            .map(
                |(member_id, user_id, email, role, joined_at)| MemberToSuspend {
                    member_id,
                    user_id,
                    email,
                    role,
                    joined_at,
                },
            )
            .collect();

        Ok(suspended)
    }
}
