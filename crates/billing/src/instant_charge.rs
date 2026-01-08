//! Instant charge service for configurable overage threshold
//!
//! Automatically charges customers when overage exceeds the threshold.
//! This prevents large overage bills from accumulating.
//!
//! Configuration via environment variables:
//! - `INSTANT_CHARGE_THRESHOLD_CENTS`: Threshold in cents (default: 5000 = $50.00)
//! - `INSTANT_CHARGE_COOLDOWN_HOURS`: Cooldown period in hours (default: 1)

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::sync::OnceLock;
use stripe::{CreateInvoice, CreateInvoiceItem, CustomerId, Invoice, InvoiceId};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::client::StripeClient;
use crate::email::BillingEmailService;
use crate::error::{BillingError, BillingResult};

/// Default threshold for instant charges in cents ($50.00)
const DEFAULT_THRESHOLD_CENTS: i32 = 5000;

/// Default cooldown period to prevent duplicate charges (1 hour)
const DEFAULT_COOLDOWN_HOURS: i64 = 1;

/// Get configured instant charge threshold
fn get_threshold_cents() -> i32 {
    static THRESHOLD: OnceLock<i32> = OnceLock::new();
    *THRESHOLD.get_or_init(|| {
        std::env::var("INSTANT_CHARGE_THRESHOLD_CENTS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_THRESHOLD_CENTS)
    })
}

/// Get configured cooldown period
fn get_cooldown_hours() -> i64 {
    static COOLDOWN: OnceLock<i64> = OnceLock::new();
    *COOLDOWN.get_or_init(|| {
        std::env::var("INSTANT_CHARGE_COOLDOWN_HOURS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_COOLDOWN_HOURS)
    })
}

/// Threshold for instant charges in cents (for backwards compatibility)
pub const INSTANT_CHARGE_THRESHOLD_CENTS: i32 = DEFAULT_THRESHOLD_CENTS;

/// Instant charge record
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct InstantCharge {
    pub id: Uuid,
    pub org_id: Uuid,
    pub amount_cents: i32,
    pub usage_at_charge: i64,
    pub overage_at_charge: i64,
    pub stripe_invoice_id: Option<String>,
    pub stripe_payment_intent_id: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub created_at: OffsetDateTime,
    pub processed_at: Option<OffsetDateTime>,
    pub paid_at: Option<OffsetDateTime>,
}

/// Response from instant charge check
#[derive(Debug, Clone, Serialize)]
pub struct InstantChargeResult {
    pub charged: bool,
    pub charge_id: Option<Uuid>,
    pub amount_cents: Option<i32>,
    pub reason: String,
}

/// Instant charge service
pub struct InstantChargeService {
    stripe: StripeClient,
    pool: PgPool,
    email: BillingEmailService,
}

impl InstantChargeService {
    pub fn new(stripe: StripeClient, pool: PgPool, email: BillingEmailService) -> Self {
        Self {
            stripe,
            pool,
            email,
        }
    }

    /// Check if instant charge is needed and process if so
    /// Returns the charge result
    ///
    /// IMPORTANT: This uses atomic INSERT...WHERE NOT EXISTS to prevent race conditions
    /// where two concurrent requests could both pass the cooldown check.
    pub async fn check_and_charge(
        &self,
        org_id: Uuid,
        current_overage_cents: i32,
        usage_count: i64,
        overage_count: i64,
    ) -> BillingResult<InstantChargeResult> {
        let threshold = get_threshold_cents();
        let cooldown_hours = get_cooldown_hours();

        // Check if below threshold
        if current_overage_cents < threshold {
            return Ok(InstantChargeResult {
                charged: false,
                charge_id: None,
                amount_cents: None,
                reason: format!(
                    "Below threshold: ${:.2} < ${:.2}",
                    current_overage_cents as f64 / 100.0,
                    threshold as f64 / 100.0
                ),
            });
        }

        // ATOMIC: Check cooldown and insert in a single query
        // This prevents race conditions where two requests could both pass the cooldown check
        let inserted: Option<InstantCharge> = sqlx::query_as(
            r#"
            INSERT INTO instant_charges (org_id, amount_cents, usage_at_charge, overage_at_charge, status)
            SELECT $1, $2, $3, $4, 'pending'
            WHERE NOT EXISTS (
                SELECT 1 FROM instant_charges
                WHERE org_id = $1
                  AND created_at > NOW() - interval '1 hour' * $5
                  AND status IN ('pending', 'processing', 'succeeded')
            )
            RETURNING *
            "#
        )
        .bind(org_id)
        .bind(current_overage_cents)
        .bind(usage_count)
        .bind(overage_count)
        .bind(cooldown_hours)
        .fetch_optional(&self.pool)
        .await?;

        // If no row was inserted, we're within cooldown period
        let charge = match inserted {
            Some(c) => c,
            None => {
                return Ok(InstantChargeResult {
                    charged: false,
                    charge_id: None,
                    amount_cents: None,
                    reason: "Already charged within cooldown period".to_string(),
                });
            }
        };

        tracing::info!(
            org_id = %org_id,
            charge_id = %charge.id,
            amount_cents = current_overage_cents,
            "Created instant charge record (atomic)"
        );

        // Get customer ID and process with Stripe
        let customer_id = self.get_stripe_customer_id(org_id).await?;

        let result = self
            .process_stripe_charge(
                charge.id,
                &customer_id,
                current_overage_cents,
                overage_count,
            )
            .await;

        match result {
            Ok(invoice_id) => {
                // Update charge with success
                sqlx::query(
                    r#"
                    UPDATE instant_charges SET
                        stripe_invoice_id = $1,
                        status = 'processing',
                        processed_at = NOW()
                    WHERE id = $2
                    "#,
                )
                .bind(&invoice_id)
                .bind(charge.id)
                .execute(&self.pool)
                .await?;

                // Send notification email
                self.send_instant_charge_notification(org_id, current_overage_cents, overage_count)
                    .await;

                Ok(InstantChargeResult {
                    charged: true,
                    charge_id: Some(charge.id),
                    amount_cents: Some(charge.amount_cents),
                    reason: format!(
                        "Instant charge created: ${:.2}",
                        charge.amount_cents as f64 / 100.0
                    ),
                })
            }
            Err(e) => {
                // Update charge with failure
                sqlx::query(
                    r#"
                    UPDATE instant_charges SET
                        status = 'failed',
                        error_message = $1,
                        processed_at = NOW()
                    WHERE id = $2
                    "#,
                )
                .bind(e.to_string())
                .bind(charge.id)
                .execute(&self.pool)
                .await?;

                tracing::error!(
                    charge_id = %charge.id,
                    error = %e,
                    "Failed to process instant charge"
                );

                Err(e)
            }
        }
    }

    /// Process Stripe charge (create invoice item + invoice, then finalize)
    async fn process_stripe_charge(
        &self,
        charge_id: Uuid,
        stripe_customer_id: &str,
        amount_cents: i32,
        overage_count: i64,
    ) -> BillingResult<String> {
        let customer_id = stripe_customer_id
            .parse::<CustomerId>()
            .map_err(|e| BillingError::StripeApi(format!("Invalid customer ID: {}", e)))?;

        // Create invoice item
        let description = format!(
            "Instant overage charge: {} API calls over limit (threshold exceeded)",
            overage_count
        );

        let mut item_params = CreateInvoiceItem::new(customer_id.clone());
        item_params.amount = Some(amount_cents as i64);
        item_params.currency = Some(stripe::Currency::USD);
        item_params.description = Some(&description);

        stripe::InvoiceItem::create(self.stripe.inner(), item_params).await?;

        // Create invoice with auto-advance for immediate payment
        let mut invoice_params = CreateInvoice::new();
        invoice_params.customer = Some(customer_id);
        invoice_params.auto_advance = Some(true);
        invoice_params.collection_method = Some(stripe::CollectionMethod::ChargeAutomatically);
        invoice_params.description = Some("Instant overage charge - threshold exceeded");

        let invoice = Invoice::create(self.stripe.inner(), invoice_params).await?;

        // Finalize the invoice to trigger payment attempt
        let invoice_id_parsed = invoice
            .id
            .as_str()
            .parse::<InvoiceId>()
            .map_err(|e| BillingError::StripeApi(format!("Invalid invoice ID: {}", e)))?;

        let _ =
            Invoice::finalize(self.stripe.inner(), &invoice_id_parsed, Default::default()).await?;

        tracing::info!(
            charge_id = %charge_id,
            invoice_id = %invoice.id,
            amount_cents = amount_cents,
            "Instant charge processed via Stripe"
        );

        Ok(invoice.id.to_string())
    }

    /// Get Stripe customer ID for org
    async fn get_stripe_customer_id(&self, org_id: Uuid) -> BillingResult<String> {
        let result: Option<(Option<String>,)> =
            sqlx::query_as("SELECT stripe_customer_id FROM organizations WHERE id = $1")
                .bind(org_id)
                .fetch_optional(&self.pool)
                .await?;

        result
            .and_then(|(id,)| id)
            .ok_or_else(|| BillingError::CustomerNotFound(org_id.to_string()))
    }

    /// Mark instant charge as paid (called from webhook)
    pub async fn mark_paid(&self, stripe_invoice_id: &str) -> BillingResult<Option<InstantCharge>> {
        let charge: Option<InstantCharge> = sqlx::query_as(
            "UPDATE instant_charges SET status = 'succeeded', paid_at = NOW() WHERE stripe_invoice_id = $1 RETURNING *"
        )
        .bind(stripe_invoice_id)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(ref c) = charge {
            tracing::info!(
                charge_id = %c.id,
                stripe_invoice_id = %stripe_invoice_id,
                "Instant charge marked as paid"
            );
        }

        Ok(charge)
    }

    /// Mark instant charge as failed (called from webhook on payment failure)
    pub async fn mark_failed(&self, stripe_invoice_id: &str, error: &str) -> BillingResult<()> {
        sqlx::query(
            "UPDATE instant_charges SET status = 'failed', error_message = $2 WHERE stripe_invoice_id = $1"
        )
        .bind(stripe_invoice_id)
        .bind(error)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get pending instant charges for an org
    pub async fn get_pending_charges(&self, org_id: Uuid) -> BillingResult<Vec<InstantCharge>> {
        let charges: Vec<InstantCharge> = sqlx::query_as(
            "SELECT id, org_id, amount_cents, usage_at_charge, overage_at_charge,
                    stripe_invoice_id, stripe_payment_intent_id, status, error_message,
                    created_at, processed_at, paid_at
             FROM instant_charges WHERE org_id = $1 AND status IN ('pending', 'processing') ORDER BY created_at DESC"
        )
        .bind(org_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(charges)
    }

    /// Get all instant charges for an org
    pub async fn get_charges(&self, org_id: Uuid, limit: i64) -> BillingResult<Vec<InstantCharge>> {
        let charges: Vec<InstantCharge> = sqlx::query_as(
            "SELECT id, org_id, amount_cents, usage_at_charge, overage_at_charge,
                    stripe_invoice_id, stripe_payment_intent_id, status, error_message,
                    created_at, processed_at, paid_at
             FROM instant_charges WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2",
        )
        .bind(org_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(charges)
    }

    /// Send notification email for instant charge
    async fn send_instant_charge_notification(
        &self,
        org_id: Uuid,
        amount_cents: i32,
        overage_count: i64,
    ) {
        // Get org owner email
        let owner: Option<(String, String)> = sqlx::query_as(
            r#"
            SELECT u.email, o.name
            FROM users u
            JOIN organizations o ON o.id = u.org_id
            WHERE u.org_id = $1 AND u.role = 'owner'
            LIMIT 1
            "#,
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await
        .ok()
        .flatten();

        if let Some((email, org_name)) = owner {
            let _ = self
                .email
                .send_instant_charge(&email, &org_name, amount_cents, overage_count)
                .await;
        }
    }
}
