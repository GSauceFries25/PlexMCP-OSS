//! Spend cap management service
//!
//! Handles user-configurable spend limits with hard pause functionality.
//! Inspired by Supabase and Vercel spend management patterns.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::OnceLock;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::email::BillingEmailService;
use crate::error::{BillingError, BillingResult};

/// Default notification thresholds (percentage of spend cap)
/// Can be overridden via SPEND_CAP_NOTIFICATION_THRESHOLDS env var (comma-separated, e.g., "50,75,90,100")
const DEFAULT_NOTIFICATION_THRESHOLDS: [i32; 4] = [50, 75, 90, 100];

/// Get configured notification thresholds
fn get_notification_thresholds() -> &'static [i32] {
    static THRESHOLDS: OnceLock<Vec<i32>> = OnceLock::new();
    THRESHOLDS.get_or_init(|| {
        std::env::var("SPEND_CAP_NOTIFICATION_THRESHOLDS")
            .ok()
            .and_then(|s| {
                let parsed: Result<Vec<i32>, _> =
                    s.split(',').map(|v| v.trim().parse::<i32>()).collect();
                parsed.ok()
            })
            .unwrap_or_else(|| DEFAULT_NOTIFICATION_THRESHOLDS.to_vec())
    })
}

/// Notification thresholds (for backwards compatibility)
pub const NOTIFICATION_THRESHOLDS: [i32; 4] = DEFAULT_NOTIFICATION_THRESHOLDS;

/// Spend cap configuration for an organization
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SpendCap {
    pub id: Uuid,
    pub org_id: Uuid,
    pub cap_amount_cents: i32,
    pub hard_pause_enabled: bool,
    pub is_paused: bool,
    pub paused_at: Option<OffsetDateTime>,
    pub current_period_spend_cents: i32,
    pub last_charge_at: Option<OffsetDateTime>,
    pub override_until: Option<OffsetDateTime>,
    pub override_by_user_id: Option<Uuid>,
    pub override_reason: Option<String>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

/// Request to create/update a spend cap
#[derive(Debug, Clone, Deserialize)]
pub struct SpendCapRequest {
    pub cap_amount_cents: i32,
    pub hard_pause_enabled: bool,
}

/// Spend cap status for API responses
#[derive(Debug, Clone, Serialize)]
pub struct SpendCapStatus {
    pub has_cap: bool,
    pub cap_amount_cents: Option<i32>,
    pub current_spend_cents: i32,
    pub percentage_used: f64,
    pub hard_pause_enabled: bool,
    pub is_paused: bool,
    #[serde(with = "time::serde::rfc3339::option")]
    pub paused_at: Option<OffsetDateTime>,
    pub has_override: bool,
    #[serde(with = "time::serde::rfc3339::option")]
    pub override_until: Option<OffsetDateTime>,
}

/// Result of spend cap check
#[derive(Debug, Clone, Serialize)]
pub enum SpendCapCheckResult {
    /// No cap configured for this org
    NoCap,
    /// Within cap limits
    Ok { spend_cents: i32, percentage: f64 },
    /// Cap exceeded and org is paused
    Paused { spend_cents: i32 },
    /// Cap exceeded but hard pause not enabled
    Exceeded { spend_cents: i32, percentage: f64 },
}

/// Spend cap service
pub struct SpendCapService {
    pool: PgPool,
    email: BillingEmailService,
}

impl SpendCapService {
    pub fn new(pool: PgPool, email: BillingEmailService) -> Self {
        Self { pool, email }
    }

    /// Get spend cap for an organization
    pub async fn get_spend_cap(&self, org_id: Uuid) -> BillingResult<Option<SpendCap>> {
        let cap: Option<SpendCap> = sqlx::query_as(
            "SELECT id, org_id, cap_amount_cents, hard_pause_enabled, is_paused, paused_at,
                    current_period_spend_cents, last_charge_at, override_until,
                    override_by_user_id, override_reason, created_at, updated_at
             FROM spend_caps WHERE org_id = $1",
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(cap)
    }

    /// Get spend cap status for API response
    pub async fn get_status(&self, org_id: Uuid) -> BillingResult<SpendCapStatus> {
        match self.get_spend_cap(org_id).await? {
            Some(cap) => {
                let has_override = cap
                    .override_until
                    .map(|t| t > OffsetDateTime::now_utc())
                    .unwrap_or(false);

                Ok(SpendCapStatus {
                    has_cap: true,
                    cap_amount_cents: Some(cap.cap_amount_cents),
                    current_spend_cents: cap.current_period_spend_cents,
                    percentage_used: if cap.cap_amount_cents > 0 {
                        (cap.current_period_spend_cents as f64 / cap.cap_amount_cents as f64)
                            * 100.0
                    } else {
                        0.0
                    },
                    hard_pause_enabled: cap.hard_pause_enabled,
                    is_paused: cap.is_paused && !has_override,
                    paused_at: cap.paused_at,
                    has_override,
                    override_until: cap.override_until,
                })
            }
            None => Ok(SpendCapStatus {
                has_cap: false,
                cap_amount_cents: None,
                current_spend_cents: 0,
                percentage_used: 0.0,
                hard_pause_enabled: false,
                is_paused: false,
                paused_at: None,
                has_override: false,
                override_until: None,
            }),
        }
    }

    /// Create or update spend cap
    pub async fn set_spend_cap(
        &self,
        org_id: Uuid,
        req: SpendCapRequest,
    ) -> BillingResult<SpendCap> {
        // Validate cap amount (minimum $10)
        if req.cap_amount_cents < 1000 {
            return Err(BillingError::InvalidInput(
                "Spend cap must be at least $10.00".to_string(),
            ));
        }

        let cap: SpendCap = sqlx::query_as(
            r#"
            INSERT INTO spend_caps (org_id, cap_amount_cents, hard_pause_enabled)
            VALUES ($1, $2, $3)
            ON CONFLICT (org_id) DO UPDATE SET
                cap_amount_cents = EXCLUDED.cap_amount_cents,
                hard_pause_enabled = EXCLUDED.hard_pause_enabled,
                updated_at = NOW()
            RETURNING *
            "#,
        )
        .bind(org_id)
        .bind(req.cap_amount_cents)
        .bind(req.hard_pause_enabled)
        .fetch_one(&self.pool)
        .await?;

        tracing::info!(
            org_id = %org_id,
            cap_amount_cents = cap.cap_amount_cents,
            hard_pause_enabled = cap.hard_pause_enabled,
            "Spend cap updated"
        );

        Ok(cap)
    }

    /// Remove spend cap
    pub async fn remove_spend_cap(&self, org_id: Uuid) -> BillingResult<()> {
        sqlx::query("DELETE FROM spend_caps WHERE org_id = $1")
            .bind(org_id)
            .execute(&self.pool)
            .await?;

        tracing::info!(org_id = %org_id, "Spend cap removed");
        Ok(())
    }

    /// Check if org is paused and should block API requests
    pub async fn check_paused(&self, org_id: Uuid) -> BillingResult<bool> {
        let cap = match self.get_spend_cap(org_id).await? {
            Some(c) => c,
            None => return Ok(false), // No cap configured
        };

        // Check if override is active
        if let Some(override_until) = cap.override_until {
            if override_until > OffsetDateTime::now_utc() {
                return Ok(false); // Override active, not paused
            }
        }

        Ok(cap.is_paused)
    }

    /// Update spend and check thresholds
    /// Called after recording overage charges
    pub async fn update_spend(
        &self,
        org_id: Uuid,
        additional_spend_cents: i32,
    ) -> BillingResult<SpendCapCheckResult> {
        let cap = match self.get_spend_cap(org_id).await? {
            Some(c) => c,
            None => return Ok(SpendCapCheckResult::NoCap),
        };

        let new_spend = cap.current_period_spend_cents + additional_spend_cents;

        // Guard against division by zero - if cap is 0, treat as 100% (always exceeded)
        let percentage = if cap.cap_amount_cents > 0 {
            (new_spend as f64 / cap.cap_amount_cents as f64) * 100.0
        } else {
            100.0 // 0 cap means always at limit
        };

        // Update current spend
        sqlx::query(
            "UPDATE spend_caps SET current_period_spend_cents = $1, updated_at = NOW() WHERE org_id = $2"
        )
        .bind(new_spend)
        .bind(org_id)
        .execute(&self.pool)
        .await?;

        // Check for threshold notifications
        for &threshold in &NOTIFICATION_THRESHOLDS {
            if percentage >= threshold as f64 {
                // Only send if we've crossed this threshold with this update
                let old_percentage = if cap.cap_amount_cents > 0 {
                    (cap.current_period_spend_cents as f64 / cap.cap_amount_cents as f64) * 100.0
                } else {
                    100.0 // 0 cap means always at limit
                };
                if old_percentage < threshold as f64 {
                    self.maybe_send_threshold_notification(
                        org_id,
                        threshold,
                        new_spend,
                        cap.cap_amount_cents,
                    )
                    .await?;
                }
            }
        }

        // Check if should pause (at 100% with hard pause enabled)
        // Uses atomic update to prevent race condition where two concurrent requests
        // could both see is_paused=false and both try to pause
        if percentage >= 100.0 && cap.hard_pause_enabled && !cap.is_paused {
            let was_paused = self.try_pause_org_atomic(org_id).await?;
            if was_paused {
                return Ok(SpendCapCheckResult::Paused {
                    spend_cents: new_spend,
                });
            }
            // If not paused (race condition - already paused by another request),
            // fall through to return Exceeded
        }

        // Return exceeded if over 100% but not paused
        if percentage >= 100.0 {
            return Ok(SpendCapCheckResult::Exceeded {
                spend_cents: new_spend,
                percentage,
            });
        }

        Ok(SpendCapCheckResult::Ok {
            spend_cents: new_spend,
            percentage,
        })
    }

    /// Sync spend from overage charges - queries total pending overage and SETS the spend
    /// Use this in worker jobs that run periodically, as it won't double-count
    pub async fn sync_spend_from_overages(
        &self,
        org_id: Uuid,
    ) -> BillingResult<SpendCapCheckResult> {
        let cap = match self.get_spend_cap(org_id).await? {
            Some(c) => c,
            None => return Ok(SpendCapCheckResult::NoCap),
        };

        // Query total pending overage charges for current billing period
        let total_pending_cents: i32 = sqlx::query_scalar(
            r#"
            SELECT COALESCE(SUM(total_charge_cents), 0)::INT
            FROM overage_charges
            WHERE org_id = $1
              AND status IN ('pending', 'awaiting_payment', 'invoiced')
            "#,
        )
        .bind(org_id)
        .fetch_one(&self.pool)
        .await?;

        let old_spend = cap.current_period_spend_cents;
        let new_spend = total_pending_cents;

        // No change needed
        if old_spend == new_spend {
            let percentage = if cap.cap_amount_cents > 0 {
                (new_spend as f64 / cap.cap_amount_cents as f64) * 100.0
            } else {
                0.0
            };
            return Ok(SpendCapCheckResult::Ok {
                spend_cents: new_spend,
                percentage,
            });
        }

        let percentage = if cap.cap_amount_cents > 0 {
            (new_spend as f64 / cap.cap_amount_cents as f64) * 100.0
        } else {
            0.0
        };

        // Update current spend (SET, not add)
        sqlx::query(
            "UPDATE spend_caps SET current_period_spend_cents = $1, updated_at = NOW() WHERE org_id = $2"
        )
        .bind(new_spend)
        .bind(org_id)
        .execute(&self.pool)
        .await?;

        // Check for threshold notifications (only if spend increased)
        if new_spend > old_spend {
            let old_percentage = if cap.cap_amount_cents > 0 {
                (old_spend as f64 / cap.cap_amount_cents as f64) * 100.0
            } else {
                0.0
            };

            // Use configurable thresholds
            for &threshold in get_notification_thresholds() {
                if percentage >= threshold as f64 && old_percentage < threshold as f64 {
                    self.maybe_send_threshold_notification(
                        org_id,
                        threshold,
                        new_spend,
                        cap.cap_amount_cents,
                    )
                    .await?;
                }
            }
        }

        // Check if should pause (at 100% with hard pause enabled)
        // ATOMIC: Use single UPDATE with WHERE conditions to prevent race condition
        if percentage >= 100.0 && cap.hard_pause_enabled {
            let paused = self.try_pause_org_atomic(org_id).await?;
            if paused {
                return Ok(SpendCapCheckResult::Paused {
                    spend_cents: new_spend,
                });
            }
        }

        // Return exceeded if over 100% but not paused
        if percentage >= 100.0 {
            return Ok(SpendCapCheckResult::Exceeded {
                spend_cents: new_spend,
                percentage,
            });
        }

        Ok(SpendCapCheckResult::Ok {
            spend_cents: new_spend,
            percentage,
        })
    }

    /// Atomically try to pause an organization's API access
    ///
    /// Uses a single UPDATE with WHERE conditions to prevent race conditions
    /// where multiple concurrent requests could all pass the "should pause" check.
    /// Returns true if this call actually paused the org, false if already paused.
    async fn try_pause_org_atomic(&self, org_id: Uuid) -> BillingResult<bool> {
        // ATOMIC: Only pause if not already paused
        let result = sqlx::query(
            r#"
            UPDATE spend_caps
            SET is_paused = true, paused_at = NOW(), updated_at = NOW()
            WHERE org_id = $1 AND is_paused = false AND hard_pause_enabled = true
            "#,
        )
        .bind(org_id)
        .execute(&self.pool)
        .await?;

        // If no rows affected, org was already paused by another request
        if result.rows_affected() == 0 {
            tracing::debug!(org_id = %org_id, "Organization already paused (race condition avoided)");
            return Ok(false);
        }

        tracing::warn!(org_id = %org_id, "Organization paused due to spend cap (atomic)");

        // Send notification email
        if let Ok(Some((email, org_name, cap_cents, spend_cents))) =
            self.get_org_owner_for_notification(org_id).await
        {
            if let Err(e) = self
                .email
                .send_api_paused(&email, &org_name, spend_cents, cap_cents)
                .await
            {
                tracing::error!(
                    org_id = %org_id,
                    email = %email,
                    error = %e,
                    "Failed to send API paused notification email"
                );
            }
        }

        Ok(true)
    }

    /// Unpause an organization (e.g., after payment or admin action)
    pub async fn unpause_org(&self, org_id: Uuid) -> BillingResult<()> {
        sqlx::query(
            "UPDATE spend_caps SET is_paused = false, paused_at = NULL, updated_at = NOW() WHERE org_id = $1"
        )
        .bind(org_id)
        .execute(&self.pool)
        .await?;

        tracing::info!(org_id = %org_id, "Organization unpaused");
        Ok(())
    }

    /// Set temporary override (admin function)
    pub async fn set_override(
        &self,
        org_id: Uuid,
        until: OffsetDateTime,
        by_user_id: Uuid,
        reason: &str,
    ) -> BillingResult<SpendCap> {
        let cap: SpendCap = sqlx::query_as(
            r#"
            UPDATE spend_caps SET
                override_until = $1,
                override_by_user_id = $2,
                override_reason = $3,
                is_paused = false,
                paused_at = NULL,
                updated_at = NOW()
            WHERE org_id = $4
            RETURNING *
            "#,
        )
        .bind(until)
        .bind(by_user_id)
        .bind(reason)
        .bind(org_id)
        .fetch_one(&self.pool)
        .await?;

        tracing::info!(
            org_id = %org_id,
            override_until = %until,
            reason = %reason,
            "Spend cap override set"
        );

        Ok(cap)
    }

    /// Clear override
    pub async fn clear_override(&self, org_id: Uuid) -> BillingResult<()> {
        sqlx::query(
            r#"
            UPDATE spend_caps SET
                override_until = NULL,
                override_by_user_id = NULL,
                override_reason = NULL,
                updated_at = NOW()
            WHERE org_id = $1
            "#,
        )
        .bind(org_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Reset spend for new billing period
    pub async fn reset_period_spend(&self, org_id: Uuid) -> BillingResult<()> {
        sqlx::query(
            "UPDATE spend_caps SET current_period_spend_cents = 0, updated_at = NOW() WHERE org_id = $1"
        )
        .bind(org_id)
        .execute(&self.pool)
        .await?;

        tracing::info!(org_id = %org_id, "Spend cap period spend reset");
        Ok(())
    }

    /// Send threshold notification if not already sent this period
    async fn maybe_send_threshold_notification(
        &self,
        org_id: Uuid,
        threshold: i32,
        current_spend: i32,
        cap_amount: i32,
    ) -> BillingResult<()> {
        // Get billing period start
        let period_start = self.get_billing_period_start(org_id).await?;

        // Check if already notified (unique constraint will prevent duplicates)
        let result = sqlx::query(
            r#"
            INSERT INTO spend_cap_notifications (org_id, billing_period_start, threshold_percent, email_to)
            SELECT $1, $2, $3, u.email
            FROM users u
            JOIN organizations o ON o.id = u.org_id
            WHERE u.org_id = $1 AND u.role = 'owner'
            LIMIT 1
            ON CONFLICT (org_id, billing_period_start, threshold_percent) DO NOTHING
            RETURNING id
            "#
        )
        .bind(org_id)
        .bind(period_start)
        .bind(threshold)
        .fetch_optional(&self.pool)
        .await;

        // Only send email if we actually inserted (wasn't a duplicate)
        if let Ok(Some(_)) = result {
            if let Ok(Some((email, org_name, _, _))) =
                self.get_org_owner_for_notification(org_id).await
            {
                if let Err(e) = self
                    .email
                    .send_spend_cap_threshold(
                        &email,
                        &org_name,
                        threshold,
                        current_spend,
                        cap_amount,
                    )
                    .await
                {
                    tracing::error!(
                        org_id = %org_id,
                        email = %email,
                        threshold = %threshold,
                        error = %e,
                        "Failed to send spend cap threshold notification email"
                    );
                }
            }
        }

        Ok(())
    }

    /// Get billing period start for the org
    async fn get_billing_period_start(&self, org_id: Uuid) -> BillingResult<OffsetDateTime> {
        // Get from subscription or default to start of month
        let sub: Option<(OffsetDateTime,)> = sqlx::query_as(
            "SELECT current_period_start FROM subscriptions WHERE org_id = $1 AND status = 'active'"
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(sub.map(|(s,)| s).unwrap_or_else(|| {
            let now = OffsetDateTime::now_utc();
            now.replace_day(1).unwrap_or(now)
        }))
    }

    /// Get org owner info for sending notifications
    async fn get_org_owner_for_notification(
        &self,
        org_id: Uuid,
    ) -> BillingResult<Option<(String, String, i32, i32)>> {
        let result: Option<(String, String, i32, i32)> = sqlx::query_as(
            r#"
            SELECT u.email, o.name,
                   COALESCE(sc.cap_amount_cents, 0) as cap_cents,
                   COALESCE(sc.current_period_spend_cents, 0) as spend_cents
            FROM users u
            JOIN organizations o ON o.id = u.org_id
            LEFT JOIN spend_caps sc ON sc.org_id = o.id
            WHERE u.org_id = $1 AND u.role = 'owner'
            LIMIT 1
            "#,
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }
}
