//! Usage-based overage billing
//!
//! This module handles charging customers for usage beyond their plan limits.
//! Overages are calculated at the end of each billing period and added to the
//! next invoice. Also supports "Pay Now" for early overage payment.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use stripe::{
    CheckoutSession, CheckoutSessionMode, CreateCheckoutSession, CreateCheckoutSessionLineItems,
    CreateCheckoutSessionLineItemsPriceData, CreateCheckoutSessionLineItemsPriceDataProductData,
    CreateInvoiceItem, Currency, CustomerId, Invoice, InvoiceId, InvoiceItem,
};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::client::StripeClient;
use crate::error::{BillingError, BillingResult};
use crate::usage::UsageMeter;

use plexmcp_shared::types::SubscriptionTier;

/// Overage rates per resource type
#[derive(Debug, Clone)]
pub struct OverageRates {
    /// Cost per 1,000 requests over limit (in cents)
    /// Pro: 50 cents ($0.50/1K), Team: 25 cents ($0.25/1K)
    pub requests_per_1k_cents: i32,
    /// Minimum number of requests to charge for (batch size)
    pub requests_batch_size: i64,
}

impl Default for OverageRates {
    fn default() -> Self {
        Self {
            // Default to Pro tier rate: $0.50 per 1,000 requests
            requests_per_1k_cents: 50,
            requests_batch_size: 1000,
        }
    }
}

impl OverageRates {
    /// Create rates from subscription tier
    /// Returns None if tier doesn't support overages (Free, Enterprise)
    pub fn for_tier(tier: SubscriptionTier) -> Option<Self> {
        tier.overage_rate_per_1k_cents().map(|rate| Self {
            requests_per_1k_cents: rate,
            requests_batch_size: 1000,
        })
    }

    /// Load rates from environment or use defaults
    pub fn from_env() -> Self {
        Self {
            requests_per_1k_cents: std::env::var("OVERAGE_RATE_REQUESTS_CENTS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(50), // Default to Pro rate
            requests_batch_size: std::env::var("OVERAGE_BATCH_SIZE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1000),
        }
    }

    /// Calculate overage charge for requests
    /// Returns charge in cents (saturates at i32::MAX to prevent overflow)
    pub fn calculate_request_overage_cents(&self, overage_count: i64) -> i32 {
        if overage_count <= 0 {
            return 0;
        }
        // Round up to batch size (1,000 requests)
        let batches = (overage_count + self.requests_batch_size - 1) / self.requests_batch_size;

        // Safe conversion with overflow protection
        let batches_i32 = if batches > i32::MAX as i64 {
            tracing::warn!(
                overage_count = overage_count,
                batches = batches,
                "Overage batches exceeds i32::MAX, capping at maximum"
            );
            i32::MAX
        } else {
            batches as i32
        };

        // Use saturating multiplication to prevent overflow
        batches_i32.saturating_mul(self.requests_per_1k_cents)
    }
}

/// Overage charge record
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct OverageCharge {
    pub id: Uuid,
    pub org_id: Uuid,
    pub billing_period_start: OffsetDateTime,
    pub billing_period_end: OffsetDateTime,
    pub resource_type: String,
    pub base_limit: i64,
    pub actual_usage: i64,
    pub overage_amount: i64,
    pub rate_per_unit_cents: i32,
    pub total_charge_cents: i32,
    pub stripe_invoice_item_id: Option<String>,
    pub status: String,
    pub created_at: OffsetDateTime,
    pub invoiced_at: Option<OffsetDateTime>,
    #[sqlx(default)]
    pub paid_at: Option<OffsetDateTime>,
}

/// Overage service for calculating and billing usage overages
pub struct OverageService {
    stripe: StripeClient,
    pool: PgPool,
    rates: OverageRates,
}

impl OverageService {
    pub fn new(stripe: StripeClient, pool: PgPool) -> Self {
        Self {
            stripe,
            pool,
            rates: OverageRates::from_env(),
        }
    }

    pub fn with_rates(stripe: StripeClient, pool: PgPool, rates: OverageRates) -> Self {
        Self { stripe, pool, rates }
    }

    /// Calculate and record overage for a billing period
    /// Does NOT create Stripe invoice item (call `bill_overage` for that)
    pub async fn calculate_period_overage(
        &self,
        org_id: Uuid,
        period_start: OffsetDateTime,
        period_end: OffsetDateTime,
        limit: u64,
        actual_usage: u64,
    ) -> BillingResult<Option<OverageCharge>> {
        // No overage if within limits
        if actual_usage <= limit || limit == u64::MAX {
            return Ok(None);
        }

        let overage_amount = (actual_usage - limit) as i64;
        let total_charge_cents = self.rates.calculate_request_overage_cents(overage_amount);

        // Don't create record if charge is zero
        if total_charge_cents == 0 {
            return Ok(None);
        }

        // Insert overage record
        let charge: OverageCharge = sqlx::query_as(
            r#"
            INSERT INTO overage_charges (
                org_id, billing_period_start, billing_period_end,
                resource_type, base_limit, actual_usage, overage_amount,
                rate_per_unit_cents, total_charge_cents, status
            )
            VALUES ($1, $2, $3, 'requests', $4, $5, $6, $7, $8, 'pending')
            RETURNING *
            "#
        )
        .bind(org_id)
        .bind(period_start)
        .bind(period_end)
        .bind(limit as i64)
        .bind(actual_usage as i64)
        .bind(overage_amount)
        .bind(self.rates.requests_per_1k_cents)
        .bind(total_charge_cents)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        tracing::info!(
            org_id = %org_id,
            overage_amount = overage_amount,
            total_charge_cents = total_charge_cents,
            "Calculated overage charge"
        );

        Ok(Some(charge))
    }

    /// Create Stripe invoice item for an overage charge
    pub async fn bill_overage(
        &self,
        charge_id: Uuid,
        stripe_customer_id: &str,
    ) -> BillingResult<OverageCharge> {
        // Get the charge
        let charge: OverageCharge = sqlx::query_as(
            "SELECT id, org_id, billing_period_start, billing_period_end, resource_type,
                    base_limit, actual_usage, overage_amount, rate_per_unit_cents,
                    total_charge_cents, stripe_invoice_item_id, status, created_at,
                    invoiced_at, paid_at
             FROM overage_charges WHERE id = $1 AND status = 'pending'"
        )
        .bind(charge_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?
        .ok_or_else(|| BillingError::NotFound("Overage charge not found".to_string()))?;

        // Create Stripe invoice item
        let customer_id = stripe_customer_id.parse::<CustomerId>()
            .map_err(|e| BillingError::StripeApi(format!("Invalid customer ID: {}", e)))?;

        let description = format!(
            "Request overage: {} requests over {} limit ({} - {})",
            charge.overage_amount,
            charge.base_limit,
            charge.billing_period_start.date(),
            charge.billing_period_end.date()
        );

        let mut params = CreateInvoiceItem::new(customer_id);
        params.amount = Some(charge.total_charge_cents as i64);
        params.currency = Some(stripe::Currency::USD);
        params.description = Some(&description);

        let invoice_item = InvoiceItem::create(self.stripe.inner(), params).await?;

        // Update charge with Stripe invoice item ID
        let updated_charge: OverageCharge = sqlx::query_as(
            r#"
            UPDATE overage_charges
            SET stripe_invoice_item_id = $1, status = 'invoiced', invoiced_at = NOW()
            WHERE id = $2
            RETURNING *
            "#
        )
        .bind(invoice_item.id.to_string())
        .bind(charge_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        tracing::info!(
            charge_id = %charge_id,
            stripe_invoice_item_id = %invoice_item.id,
            amount_cents = charge.total_charge_cents,
            "Billed overage to Stripe"
        );

        Ok(updated_charge)
    }

    /// Mark an overage charge as paid (called from webhook)
    pub async fn mark_paid(&self, charge_id: Uuid) -> BillingResult<()> {
        sqlx::query(
            "UPDATE overage_charges SET status = 'paid', paid_at = NOW() WHERE id = $1"
        )
        .bind(charge_id)
        .execute(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        Ok(())
    }

    /// Waive an overage charge (e.g., for goodwill)
    pub async fn waive_overage(&self, charge_id: Uuid, reason: &str) -> BillingResult<()> {
        sqlx::query(
            r#"
            UPDATE overage_charges
            SET status = 'waived',
                metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{waive_reason}', to_jsonb($2::text))
            WHERE id = $1
            "#
        )
        .bind(charge_id)
        .bind(reason)
        .execute(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        tracing::info!(charge_id = %charge_id, reason = %reason, "Waived overage charge");

        Ok(())
    }

    /// Get pending overage charges for an org (includes abandoned Pay Now checkouts)
    pub async fn get_pending_charges(&self, org_id: Uuid) -> BillingResult<Vec<OverageCharge>> {
        let charges: Vec<OverageCharge> = sqlx::query_as(
            "SELECT id, org_id, billing_period_start, billing_period_end, resource_type,
                    base_limit, actual_usage, overage_amount, rate_per_unit_cents,
                    total_charge_cents, stripe_invoice_item_id, status, created_at,
                    invoiced_at, paid_at
             FROM overage_charges WHERE org_id = $1 AND status IN ('pending', 'awaiting_payment') ORDER BY created_at DESC"
        )
        .bind(org_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        Ok(charges)
    }

    /// Get total pending overage amount in cents for an org
    pub async fn get_pending_overage_total(&self, org_id: Uuid) -> BillingResult<i64> {
        let total: Option<(Option<i64>,)> = sqlx::query_as(
            "SELECT SUM(total_charge_cents)::bigint FROM overage_charges WHERE org_id = $1 AND status IN ('pending', 'awaiting_payment')"
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        Ok(total.and_then(|(t,)| t).unwrap_or(0))
    }

    /// Get all overage charges for an org
    pub async fn get_charges(&self, org_id: Uuid, limit: i64) -> BillingResult<Vec<OverageCharge>> {
        let charges: Vec<OverageCharge> = sqlx::query_as(
            "SELECT id, org_id, billing_period_start, billing_period_end, resource_type,
                    base_limit, actual_usage, overage_amount, rate_per_unit_cents,
                    total_charge_cents, stripe_invoice_item_id, status, created_at,
                    invoiced_at, paid_at
             FROM overage_charges WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2"
        )
        .bind(org_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        Ok(charges)
    }

    /// Process end-of-period overage for an organization
    /// This should be called when a billing period ends (e.g., via webhook or cron)
    pub async fn process_billing_period_overage(
        &self,
        org_id: Uuid,
        stripe_customer_id: &str,
        period_start: OffsetDateTime,
        period_end: OffsetDateTime,
        limit: u64,
    ) -> BillingResult<Option<OverageCharge>> {
        // Get actual usage for the period
        let usage_meter = UsageMeter::new(self.pool.clone());
        let actual_usage = usage_meter
            .get_total_requests_for_period(org_id, period_start, period_end)
            .await?;

        // Calculate overage
        let charge = self.calculate_period_overage(
            org_id,
            period_start,
            period_end,
            limit,
            actual_usage,
        ).await?;

        // Bill to Stripe if there's an overage
        if let Some(charge) = charge {
            let billed = self.bill_overage(charge.id, stripe_customer_id).await?;
            return Ok(Some(billed));
        }

        Ok(None)
    }
}

/// Summary of overage for display
#[derive(Debug, Clone, Serialize)]
pub struct OverageSummary {
    pub has_pending_overages: bool,
    pub pending_total_cents: i32,
    pub pending_charges: Vec<OverageCharge>,
}

impl OverageSummary {
    pub async fn for_org(pool: &PgPool, org_id: Uuid) -> BillingResult<Self> {
        let charges: Vec<OverageCharge> = sqlx::query_as(
            "SELECT id, org_id, billing_period_start, billing_period_end, resource_type,
                    base_limit, actual_usage, overage_amount, rate_per_unit_cents,
                    total_charge_cents, stripe_invoice_item_id, status, created_at,
                    invoiced_at, paid_at
             FROM overage_charges WHERE org_id = $1 AND status IN ('pending', 'awaiting_payment') ORDER BY created_at DESC"
        )
        .bind(org_id)
        .fetch_all(pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        let pending_total_cents: i32 = charges.iter().map(|c| c.total_charge_cents).sum();

        Ok(Self {
            has_pending_overages: !charges.is_empty(),
            pending_total_cents,
            pending_charges: charges,
        })
    }
}

/// Accumulated overage information for Pay Now functionality
#[derive(Debug, Clone, Serialize)]
pub struct AccumulatedOverage {
    /// Total overage amount in cents
    pub total_cents: i32,
    /// Total number of overage requests
    pub total_requests: i64,
    /// Number of pending charges
    pub charge_count: i32,
    /// Individual pending charges
    pub charges: Vec<OverageCharge>,
}

/// Result of a Pay Now operation
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status")]
pub enum PayNowResult {
    /// No pending charges to pay
    NoPendingCharges,
    /// Payment initiated - user must complete payment via Stripe Checkout
    PaymentRequired {
        /// Stripe Checkout Session ID
        checkout_session_id: String,
        /// Checkout URL for user to complete payment
        checkout_url: String,
        /// Total amount in cents
        amount_cents: i32,
        /// Number of charges included
        charge_count: i32,
    },
    /// Payment already completed (from existing session)
    AlreadyPaid {
        /// Total amount in cents
        amount_cents: i32,
        /// Number of charges
        charge_count: i32,
    },
}

impl OverageService {
    /// Get accumulated overage for Pay Now display
    /// Shows charges that are pending OR awaiting payment (invoice created but not yet paid)
    pub async fn get_accumulated_overage(&self, org_id: Uuid) -> BillingResult<AccumulatedOverage> {
        let charges: Vec<OverageCharge> = sqlx::query_as(
            r#"
            SELECT id, org_id, billing_period_start, billing_period_end, resource_type,
                   base_limit, actual_usage, overage_amount, rate_per_unit_cents,
                   total_charge_cents, stripe_invoice_item_id, status, created_at,
                   invoiced_at, paid_at
            FROM overage_charges
            WHERE org_id = $1
              AND status IN ('pending', 'awaiting_payment')
            ORDER BY created_at DESC
            "#
        )
        .bind(org_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        let total_cents: i32 = charges.iter().map(|c| c.total_charge_cents).sum();
        let total_requests: i64 = charges.iter().map(|c| c.overage_amount).sum();
        let charge_count = charges.len() as i32;

        Ok(AccumulatedOverage {
            total_cents,
            total_requests,
            charge_count,
            charges,
        })
    }

    /// Pay all pending overages now (before billing cycle ends)
    /// Creates a Stripe Checkout Session for the user to complete payment
    ///
    /// IMPORTANT: Uses Checkout Sessions instead of Invoices to GUARANTEE user interaction.
    /// Invoices can auto-charge saved payment methods, but Checkout Sessions always
    /// require the user to complete the payment form.
    ///
    /// This function is idempotent - concurrent calls will return the same session.
    pub async fn pay_overages_now(
        &self,
        org_id: Uuid,
        stripe_customer_id: &str,
    ) -> BillingResult<PayNowResult> {
        // First, check if there's an existing checkout session awaiting payment
        let existing_session: Option<(String, i32, i32)> = sqlx::query_as(
            r#"
            SELECT early_payment_invoice_id,
                   SUM(total_charge_cents)::INT as total,
                   COUNT(*)::INT as charge_count
            FROM overage_charges
            WHERE org_id = $1
              AND status = 'awaiting_payment'
              AND early_payment_invoice_id IS NOT NULL
            GROUP BY early_payment_invoice_id
            ORDER BY MAX(created_at) DESC
            LIMIT 1
            "#
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        if let Some((session_id, amount_cents, charge_count)) = existing_session {
            // Check if session is still valid by retrieving it from Stripe
            let session_id_parsed = session_id.parse::<stripe::CheckoutSessionId>()
                .map_err(|e| BillingError::StripeApi(format!("Invalid session ID: {}", e)))?;

            match CheckoutSession::retrieve(self.stripe.inner(), &session_id_parsed, &[]).await {
                Ok(session) => {
                    // Check if session is already paid
                    if session.payment_status == stripe::CheckoutSessionPaymentStatus::Paid {
                        // Already paid - mark charges as paid and return
                        self.mark_early_payment_paid(&session_id).await?;
                        return Ok(PayNowResult::AlreadyPaid {
                            amount_cents,
                            charge_count,
                        });
                    }

                    // Session still valid and unpaid - return existing URL
                    if let Some(url) = session.url {
                        return Ok(PayNowResult::PaymentRequired {
                            checkout_session_id: session_id,
                            checkout_url: url,
                            amount_cents,
                            charge_count,
                        });
                    } else {
                        // Session expired (no URL) but wasn't paid - reset charges so a new session can be created
                        tracing::info!(
                            org_id = %org_id,
                            session_id = %session_id,
                            "Checkout session expired without payment, resetting charges"
                        );
                        sqlx::query(
                            r#"
                            UPDATE overage_charges SET
                                status = 'pending',
                                paid_early = false,
                                early_payment_invoice_id = NULL
                            WHERE org_id = $1
                              AND status = 'awaiting_payment'
                              AND early_payment_invoice_id = $2
                            "#
                        )
                        .bind(org_id)
                        .bind(&session_id)
                        .execute(&self.pool)
                        .await
                        .ok();
                    }
                }
                Err(_) => {
                    // Session expired or invalid - reset charges and create new one
                    sqlx::query(
                        r#"
                        UPDATE overage_charges SET
                            status = 'pending',
                            paid_early = false,
                            early_payment_invoice_id = NULL
                        WHERE org_id = $1
                          AND status = 'awaiting_payment'
                          AND early_payment_invoice_id = $2
                        "#
                    )
                    .bind(org_id)
                    .bind(&session_id)
                    .execute(&self.pool)
                    .await
                    .ok();
                }
            }
        }

        // Reset any stale 'awaiting_payment' charges that don't have a valid checkout session
        // This handles edge cases where checkout sessions expired without proper cleanup
        sqlx::query(
            r#"
            UPDATE overage_charges SET
                status = 'pending',
                paid_early = false,
                early_payment_invoice_id = NULL
            WHERE org_id = $1
              AND status = 'awaiting_payment'
              AND (early_payment_invoice_id IS NULL OR early_payment_invoice_id = '')
            "#
        )
        .bind(org_id)
        .execute(&self.pool)
        .await
        .ok(); // Ignore errors here, we'll proceed with the main query

        // Use a transaction with row-level locking to prevent double-charging
        let mut tx = self.pool.begin().await
            .map_err(|e| BillingError::Database(e.to_string()))?;

        // Atomically select and lock pending charges for this org
        let charges: Vec<OverageCharge> = sqlx::query_as(
            r#"
            SELECT id, org_id, billing_period_start, billing_period_end, resource_type,
                   base_limit, actual_usage, overage_amount, rate_per_unit_cents,
                   total_charge_cents, stripe_invoice_item_id, status, created_at,
                   invoiced_at, paid_at
            FROM overage_charges
            WHERE org_id = $1
              AND status = 'pending'
              AND (paid_early IS NULL OR paid_early = false)
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            "#
        )
        .bind(org_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        if charges.is_empty() {
            tx.rollback().await.ok();
            return Ok(PayNowResult::NoPendingCharges);
        }

        let total_cents: i32 = charges.iter().map(|c| c.total_charge_cents).sum();
        let total_overage: i64 = charges.iter().map(|c| c.overage_amount).sum();
        let charge_count = charges.len() as i32;
        let charge_ids: Vec<Uuid> = charges.iter().map(|c| c.id).collect();

        // Mark charges as 'processing' to prevent concurrent requests
        sqlx::query(
            r#"
            UPDATE overage_charges SET status = 'processing'
            WHERE id = ANY($1)
            "#
        )
        .bind(&charge_ids)
        .execute(&mut *tx)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        tx.commit().await
            .map_err(|e| BillingError::Database(e.to_string()))?;

        // Parse customer ID
        let customer_id = stripe_customer_id.parse::<CustomerId>()
            .map_err(|e| BillingError::StripeApi(format!("Invalid customer ID: {}", e)))?;

        // Create Stripe Checkout Session for one-time payment
        let checkout_result = self.create_pay_now_checkout(
            org_id,
            customer_id,
            total_cents,
            total_overage,
        ).await;

        // Handle errors by resetting charges
        let session = match checkout_result {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(
                    org_id = %org_id,
                    error = %e,
                    total_cents = total_cents,
                    charge_count = charge_count,
                    "Failed to create Checkout Session for overage payment"
                );
                self.reset_processing_charges(&charge_ids).await;
                return Err(e);
            }
        };

        let session_id = session.id.to_string();
        let checkout_url = session.url.clone().ok_or_else(|| {
            BillingError::StripeApi("Checkout session created without URL".to_string())
        })?;

        // Update charges with session ID and mark as awaiting_payment
        for charge_id in &charge_ids {
            sqlx::query(
                r#"
                UPDATE overage_charges SET
                    status = 'awaiting_payment',
                    paid_early = false,
                    early_payment_invoice_id = $1
                WHERE id = $2
                "#
            )
            .bind(&session_id)
            .bind(charge_id)
            .execute(&self.pool)
            .await
            .map_err(|e| BillingError::Database(e.to_string()))?;
        }

        tracing::info!(
            org_id = %org_id,
            session_id = %session_id,
            checkout_url = %checkout_url,
            amount_cents = total_cents,
            charge_count = charge_count,
            "Created Checkout Session for overage payment"
        );

        Ok(PayNowResult::PaymentRequired {
            checkout_session_id: session_id,
            checkout_url,
            amount_cents: total_cents,
            charge_count,
        })
    }

    /// Mark early-paid charges as fully paid (called from webhook when invoice is paid)
    pub async fn mark_early_payment_paid(&self, stripe_invoice_id: &str) -> BillingResult<i32> {
        let result = sqlx::query(
            r#"
            UPDATE overage_charges SET
                status = 'paid',
                paid_early = true,
                paid_at = NOW()
            WHERE early_payment_invoice_id = $1
              AND status IN ('awaiting_payment', 'processing', 'invoiced')
            "#
        )
        .bind(stripe_invoice_id)
        .execute(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        let rows_affected = result.rows_affected() as i32;

        if rows_affected > 0 {
            tracing::info!(
                stripe_invoice_id = %stripe_invoice_id,
                charges_marked_paid = rows_affected,
                "Early payment charges marked as paid"
            );
        }

        Ok(rows_affected)
    }

    /// Mark overage charges as paid when a subscription invoice is paid
    /// Looks up invoice items on the paid invoice and matches them to overage charges
    pub async fn mark_invoiced_charges_paid(&self, org_id: Uuid, stripe_invoice_id: &str) -> BillingResult<i32> {
        // Fetch invoice line items from Stripe to find any overage invoice items
        let invoice_id = stripe_invoice_id.parse::<stripe::InvoiceId>()
            .map_err(|e| BillingError::StripeApi(format!("Invalid invoice ID: {}", e)))?;

        let invoice = stripe::Invoice::retrieve(self.stripe.inner(), &invoice_id, &[])
            .await
            .map_err(|e| BillingError::StripeApi(e.to_string()))?;

        // Get line item IDs from the invoice
        let line_item_ids: Vec<String> = invoice.lines
            .as_ref()
            .map(|lines| {
                lines.data.iter()
                    .filter_map(|item| {
                        item.invoice_item.as_ref().map(|ii| {
                            match ii {
                                stripe::Expandable::Id(id) => id.to_string(),
                                stripe::Expandable::Object(obj) => obj.id.to_string(),
                            }
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        if line_item_ids.is_empty() {
            return Ok(0);
        }

        // Mark overage charges with matching stripe_invoice_item_id as paid
        let result = sqlx::query(
            r#"
            UPDATE overage_charges SET
                status = 'paid',
                paid_at = NOW()
            WHERE org_id = $1
              AND stripe_invoice_item_id = ANY($2)
              AND status = 'invoiced'
            "#
        )
        .bind(org_id)
        .bind(&line_item_ids)
        .execute(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        let rows_affected = result.rows_affected() as i32;

        if rows_affected > 0 {
            tracing::info!(
                org_id = %org_id,
                stripe_invoice_id = %stripe_invoice_id,
                line_items_checked = line_item_ids.len(),
                charges_marked_paid = rows_affected,
                "Invoiced overage charges marked as paid"
            );
        }

        Ok(rows_affected)
    }

    /// Mark overages that were included in an upgrade checkout as paid
    /// Called when checkout session completes successfully
    pub async fn mark_upgrade_overages_paid(&self, org_id: Uuid) -> BillingResult<i32> {
        let result = sqlx::query(
            r#"
            UPDATE overage_charges SET
                status = 'paid',
                paid_at = NOW()
            WHERE org_id = $1
              AND status = 'pending_upgrade_payment'
            "#
        )
        .bind(org_id)
        .execute(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        let rows_affected = result.rows_affected() as i32;

        if rows_affected > 0 {
            tracing::info!(
                org_id = %org_id,
                charges_marked_paid = rows_affected,
                "Upgrade overage charges marked as paid"
            );
        }

        Ok(rows_affected)
    }

    /// Create or update overage_charges record for current billing period.
    /// Called from worker job and when user views billing page.
    /// This populates the overage_charges table in real-time as usage occurs.
    /// Handles incremental charges when previous charges have been paid early.
    pub async fn create_or_update_current_overage(
        &self,
        org_id: Uuid,
        tier: &str,
        period_start: OffsetDateTime,
        period_end: OffsetDateTime,
    ) -> BillingResult<Option<OverageCharge>> {
        // Get current usage from usage_records (source of truth for billing)
        // usage_aggregates is for analytics only and may contain test/batch data
        // Truncate to day boundaries since usage_records use daily periods but Stripe
        // billing periods can start at any time of day (e.g., 03:42:05)
        let total_usage: i64 = sqlx::query_scalar::<_, Option<i64>>(
            r#"
            SELECT COALESCE(SUM(request_count), 0)::BIGINT
            FROM usage_records
            WHERE org_id = $1
              AND period_start >= date_trunc('day', $2::timestamptz)
              AND period_start < date_trunc('day', $3::timestamptz) + interval '1 day'
            "#
        )
        .bind(org_id)
        .bind(period_start)
        .bind(period_end)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?
        .unwrap_or(0);

        // 2. Get limit for tier
        let tier_parsed: SubscriptionTier = tier.parse().unwrap_or(SubscriptionTier::Free);
        let limit = tier_parsed.monthly_requests() as i64;

        // 3. No overage if within limits or unlimited
        if total_usage <= limit || limit == i64::MAX {
            // Delete any existing pending overage that hasn't started payment (user dropped below limit)
            sqlx::query(
                r#"
                DELETE FROM overage_charges
                WHERE org_id = $1
                  AND billing_period_start = $2
                  AND resource_type = 'requests'
                  AND status = 'pending'
                  AND (paid_early IS NULL OR paid_early = false)
                "#
            )
            .bind(org_id)
            .bind(period_start)
            .execute(&self.pool)
            .await
            .ok(); // Ignore errors on cleanup

            return Ok(None);
        }

        let total_overage_amount = total_usage - limit;

        // 4. Get rate for tier
        let rates = OverageRates::for_tier(tier_parsed);
        let rate_per_unit = rates.as_ref().map(|r| r.requests_per_1k_cents).unwrap_or(0);
        let total_charge_cents = rates
            .as_ref()
            .map(|r| r.calculate_request_overage_cents(total_overage_amount))
            .unwrap_or(0);

        if total_charge_cents == 0 {
            return Ok(None);
        }

        // 5. Check how much has already been paid/invoiced for this billing period
        let already_charged: i32 = sqlx::query_scalar::<_, Option<i32>>(
            r#"
            SELECT COALESCE(SUM(total_charge_cents), 0)::INT
            FROM overage_charges
            WHERE org_id = $1
              AND billing_period_start = $2
              AND resource_type = 'requests'
              AND status IN ('paid', 'invoiced')
            "#
        )
        .bind(org_id)
        .bind(period_start)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?
        .unwrap_or(0);

        // Calculate the incremental charge (new overage minus what's already paid)
        let incremental_charge_cents = total_charge_cents - already_charged;

        // No new charge needed if already paid up
        if incremental_charge_cents <= 0 {
            // Delete any pending charge that hasn't started payment since we're fully paid
            sqlx::query(
                r#"
                DELETE FROM overage_charges
                WHERE org_id = $1
                  AND billing_period_start = $2
                  AND resource_type = 'requests'
                  AND status = 'pending'
                  AND (paid_early IS NULL OR paid_early = false)
                "#
            )
            .bind(org_id)
            .bind(period_start)
            .execute(&self.pool)
            .await
            .ok();

            return Ok(None);
        }

        // Calculate the incremental overage amount (requests not yet charged for)
        let already_charged_overage: i64 = sqlx::query_scalar::<_, Option<i64>>(
            r#"
            SELECT COALESCE(SUM(overage_amount), 0)::BIGINT
            FROM overage_charges
            WHERE org_id = $1
              AND billing_period_start = $2
              AND resource_type = 'requests'
              AND status IN ('paid', 'invoiced')
            "#
        )
        .bind(org_id)
        .bind(period_start)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?
        .unwrap_or(0);

        let incremental_overage = total_overage_amount - already_charged_overage;

        // 6. Check if there's an existing pending/awaiting charge to update, or if we need a new one
        // Include 'awaiting_payment' to prevent duplicates when user cancels Stripe checkout
        let existing_pending: Option<Uuid> = sqlx::query_scalar(
            r#"
            SELECT id FROM overage_charges
            WHERE org_id = $1
              AND billing_period_start = $2
              AND resource_type = 'requests'
              AND status IN ('pending', 'awaiting_payment')
              AND (paid_early IS NULL OR paid_early = false)
            "#
        )
        .bind(org_id)
        .bind(period_start)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        let charge: OverageCharge = if let Some(charge_id) = existing_pending {
            // Update existing pending charge
            sqlx::query_as(
                r#"
                UPDATE overage_charges SET
                    actual_usage = $1,
                    overage_amount = $2,
                    total_charge_cents = $3
                WHERE id = $4
                RETURNING *
                "#
            )
            .bind(total_usage)
            .bind(incremental_overage)
            .bind(incremental_charge_cents)
            .bind(charge_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| BillingError::Database(e.to_string()))?
        } else {
            // Create new pending charge for incremental overage
            sqlx::query_as(
                r#"
                INSERT INTO overage_charges (
                    org_id, billing_period_start, billing_period_end,
                    resource_type, base_limit, actual_usage, overage_amount,
                    rate_per_unit_cents, total_charge_cents, status
                )
                VALUES ($1, $2, $3, 'requests', $4, $5, $6, $7, $8, 'pending')
                RETURNING *
                "#
            )
            .bind(org_id)
            .bind(period_start)
            .bind(period_end)
            .bind(limit)
            .bind(total_usage)
            .bind(incremental_overage)
            .bind(rate_per_unit)
            .bind(incremental_charge_cents)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| BillingError::Database(e.to_string()))?
        };

        tracing::info!(
            org_id = %org_id,
            total_overage = total_overage_amount,
            incremental_overage = incremental_overage,
            incremental_charge_cents = incremental_charge_cents,
            already_charged_cents = already_charged,
            "Created/updated real-time overage charge"
        );

        Ok(Some(charge))
    }

    /// Sync early payment status by checking Stripe invoice status.
    /// This is a fallback for when webhooks don't fire or are misconfigured.
    /// Called when loading overages to ensure we have the latest payment status.
    pub async fn sync_early_payment_status(&self, org_id: Uuid) -> BillingResult<i32> {
        // Find charges that are awaiting payment and have an invoice ID
        let unpaid_early_charges: Vec<(Uuid, String)> = sqlx::query_as(
            r#"
            SELECT id, early_payment_invoice_id
            FROM overage_charges
            WHERE org_id = $1
              AND status IN ('awaiting_payment', 'processing', 'invoiced')
              AND early_payment_invoice_id IS NOT NULL
            "#
        )
        .bind(org_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        if unpaid_early_charges.is_empty() {
            return Ok(0);
        }

        let mut synced = 0;

        for (charge_id, invoice_id_str) in unpaid_early_charges {
            // Parse and fetch the Stripe invoice
            let invoice_id = match invoice_id_str.parse::<InvoiceId>() {
                Ok(id) => id,
                Err(e) => {
                    tracing::warn!(
                        charge_id = %charge_id,
                        invoice_id = %invoice_id_str,
                        error = %e,
                        "Failed to parse invoice ID for sync"
                    );
                    continue;
                }
            };

            let invoice = match Invoice::retrieve(self.stripe.inner(), &invoice_id, &[]).await {
                Ok(inv) => inv,
                Err(e) => {
                    tracing::warn!(
                        charge_id = %charge_id,
                        invoice_id = %invoice_id_str,
                        error = %e,
                        "Failed to retrieve invoice from Stripe for sync"
                    );
                    continue;
                }
            };

            // Check if invoice is paid
            if invoice.status == Some(stripe::InvoiceStatus::Paid) {
                // Update the charge to paid status
                sqlx::query(
                    r#"
                    UPDATE overage_charges SET
                        status = 'paid',
                        paid_early = true,
                        paid_at = NOW()
                    WHERE id = $1
                    "#
                )
                .bind(charge_id)
                .execute(&self.pool)
                .await
                .map_err(|e| BillingError::Database(e.to_string()))?;

                tracing::info!(
                    charge_id = %charge_id,
                    invoice_id = %invoice_id_str,
                    "Synced early payment status from Stripe (webhook fallback)"
                );

                synced += 1;
            }
        }

        if synced > 0 {
            tracing::info!(
                org_id = %org_id,
                charges_synced = synced,
                "Synced early payment status from Stripe"
            );
        }

        Ok(synced)
    }

    /// Create a Stripe Checkout Session for Pay Now
    ///
    /// Uses Checkout Sessions (mode=payment) which ALWAYS requires user interaction.
    /// This guarantees the user sees the payment form and must confirm payment.
    async fn create_pay_now_checkout(
        &self,
        org_id: Uuid,
        customer_id: CustomerId,
        total_cents: i32,
        total_overage: i64,
    ) -> BillingResult<CheckoutSession> {
        let base_url = &self.stripe.config().app_base_url;
        let success_url = format!(
            "{}/billing?payment=success&session_id={{CHECKOUT_SESSION_ID}}",
            base_url
        );
        let cancel_url = format!("{}/billing?payment=cancelled", base_url);

        let description = format!(
            "Overage payment: {} requests over plan limit",
            total_overage
        );

        let mut metadata = std::collections::HashMap::new();
        metadata.insert("org_id".to_string(), org_id.to_string());
        metadata.insert("checkout_type".to_string(), "overage_payment".to_string());
        metadata.insert("overage_requests".to_string(), total_overage.to_string());

        // Create line item with price_data for custom amount
        let line_items = vec![CreateCheckoutSessionLineItems {
            price_data: Some(CreateCheckoutSessionLineItemsPriceData {
                currency: Currency::USD,
                unit_amount: Some(total_cents as i64),
                product_data: Some(CreateCheckoutSessionLineItemsPriceDataProductData {
                    name: "API Overage Payment".to_string(),
                    description: Some(description),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            quantity: Some(1),
            ..Default::default()
        }];

        let params = CreateCheckoutSession {
            customer: Some(customer_id.clone()),
            mode: Some(CheckoutSessionMode::Payment), // One-time payment, not subscription
            line_items: Some(line_items),
            success_url: Some(&success_url),
            cancel_url: Some(&cancel_url),
            metadata: Some(metadata),
            ..Default::default()
        };

        tracing::info!(
            org_id = %org_id,
            customer_id = %customer_id,
            amount_cents = total_cents,
            success_url = %success_url,
            cancel_url = %cancel_url,
            "Creating Stripe Checkout Session for overage payment"
        );

        let session = match CheckoutSession::create(self.stripe.inner(), params).await {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(
                    org_id = %org_id,
                    error = %e,
                    "Stripe Checkout Session creation failed"
                );
                return Err(e.into());
            }
        };

        tracing::info!(
            org_id = %org_id,
            session_id = %session.id,
            amount_cents = total_cents,
            "Created Checkout Session for overage payment"
        );

        Ok(session)
    }

    /// Reset charges from 'processing' back to 'pending' on failure
    async fn reset_processing_charges(&self, charge_ids: &[Uuid]) {
        if let Err(e) = sqlx::query(
            r#"
            UPDATE overage_charges SET
                status = 'pending',
                paid_early = false
            WHERE id = ANY($1)
              AND status = 'processing'
            "#
        )
        .bind(charge_ids)
        .execute(&self.pool)
        .await
        {
            tracing::error!(
                error = %e,
                charge_count = charge_ids.len(),
                "Failed to reset processing charges - manual intervention may be needed"
            );
        }
    }

    /// Mark pending charges for a billing period as paid
    /// Called when a subscription invoice for that period is paid (via metered billing)
    pub async fn mark_period_charges_paid(
        &self,
        org_id: Uuid,
        period_start: OffsetDateTime,
        period_end: OffsetDateTime,
        stripe_invoice_id: &str,
    ) -> BillingResult<i32> {
        // Mark any pending charges that fall within this billing period as paid
        // This handles charges that were tracked for display but billed via metered usage
        let result = sqlx::query(
            r#"
            UPDATE overage_charges SET
                status = 'paid',
                paid_at = NOW(),
                stripe_invoice_item_id = COALESCE(stripe_invoice_item_id, $4)
            WHERE org_id = $1
              AND billing_period_start >= $2
              AND billing_period_end <= $3
              AND status = 'pending'
              AND (paid_early IS NULL OR paid_early = false)
            "#
        )
        .bind(org_id)
        .bind(period_start)
        .bind(period_end)
        .bind(stripe_invoice_id)
        .execute(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        let rows_affected = result.rows_affected() as i32;

        if rows_affected > 0 {
            tracing::info!(
                org_id = %org_id,
                period_start = %period_start,
                period_end = %period_end,
                charges_marked_paid = rows_affected,
                "Marked period overage charges as paid via metered billing"
            );
        }

        Ok(rows_affected)
    }
}
