//! Billing History Export
//!
//! Provides functionality to export billing history to CSV format for:
//! - Compliance and audit requirements
//! - Customer billing statements
//! - Financial reconciliation

use serde::Serialize;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::{BillingError, BillingResult};

/// Service for exporting billing history
pub struct BillingHistoryService {
    pool: PgPool,
}

impl BillingHistoryService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Export billing history for an organization to CSV format
    pub async fn export_org_history_csv(
        &self,
        org_id: Uuid,
        start_date: Option<OffsetDateTime>,
        end_date: Option<OffsetDateTime>,
    ) -> BillingResult<String> {
        let records = self
            .get_billing_history(org_id, start_date, end_date)
            .await?;

        let mut csv = String::new();

        // CSV Header
        csv.push_str("Date,Type,Description,Amount (USD),Status,Reference\n");

        for record in records {
            let amount_dollars = record.amount_cents as f64 / 100.0;
            let date = record
                .created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_else(|_| "unknown".to_string());

            // Escape CSV fields
            let description = escape_csv_field(&record.description);
            let reference = escape_csv_field(&record.reference.unwrap_or_default());

            csv.push_str(&format!(
                "{},{},{},{:.2},{},{}\n",
                date, record.record_type, description, amount_dollars, record.status, reference
            ));
        }

        Ok(csv)
    }

    /// Get billing history records for an organization
    pub async fn get_billing_history(
        &self,
        org_id: Uuid,
        start_date: Option<OffsetDateTime>,
        end_date: Option<OffsetDateTime>,
    ) -> BillingResult<Vec<BillingHistoryRecord>> {
        let start = start_date.unwrap_or_else(|| {
            // Default to 1 year ago
            OffsetDateTime::now_utc() - time::Duration::days(365)
        });
        let end = end_date.unwrap_or_else(OffsetDateTime::now_utc);

        let mut records = Vec::new();

        // Get tier changes from audit log
        let tier_changes: Vec<TierChangeRow> = sqlx::query_as(
            r#"
            SELECT
                created_at,
                from_tier,
                to_tier,
                source,
                reason
            FROM tier_change_audit
            WHERE org_id = $1
              AND created_at >= $2
              AND created_at <= $3
            ORDER BY created_at DESC
            "#,
        )
        .bind(org_id)
        .bind(start)
        .bind(end)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        for row in tier_changes {
            records.push(BillingHistoryRecord {
                created_at: row.created_at,
                record_type: "tier_change".to_string(),
                description: format!("{} → {} ({})", row.from_tier, row.to_tier, row.source),
                amount_cents: 0,
                status: "completed".to_string(),
                reference: row.reason,
            });
        }

        // Get overage charges
        let overages: Vec<OverageRow> = sqlx::query_as(
            r#"
            SELECT
                created_at,
                resource_type,
                overage_amount,
                total_charge_cents,
                status,
                stripe_invoice_item_id
            FROM overage_charges
            WHERE org_id = $1
              AND created_at >= $2
              AND created_at <= $3
            ORDER BY created_at DESC
            "#,
        )
        .bind(org_id)
        .bind(start)
        .bind(end)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        for row in overages {
            records.push(BillingHistoryRecord {
                created_at: row.created_at,
                record_type: "overage".to_string(),
                description: format!(
                    "{} overage ({} units)",
                    row.resource_type, row.overage_amount
                ),
                amount_cents: row.total_charge_cents,
                status: row.status,
                reference: row.stripe_invoice_item_id,
            });
        }

        // Get refunds
        let refunds: Vec<RefundRow> = sqlx::query_as(
            r#"
            SELECT
                created_at,
                amount_cents,
                refund_type,
                reason,
                status,
                stripe_refund_id
            FROM refund_audit
            WHERE org_id = $1
              AND created_at >= $2
              AND created_at <= $3
            ORDER BY created_at DESC
            "#,
        )
        .bind(org_id)
        .bind(start)
        .bind(end)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        for row in refunds {
            records.push(BillingHistoryRecord {
                created_at: row.created_at,
                record_type: row.refund_type,
                description: row.reason.unwrap_or_else(|| "Refund".to_string()),
                amount_cents: -row.amount_cents, // Negative for refunds
                status: row.status,
                reference: row.stripe_refund_id,
            });
        }

        // Get instant charges
        let instant_charges: Vec<InstantChargeRow> = sqlx::query_as(
            r#"
            SELECT
                created_at,
                amount_cents,
                overage_amount,
                status,
                stripe_invoice_id
            FROM instant_charges
            WHERE org_id = $1
              AND created_at >= $2
              AND created_at <= $3
            ORDER BY created_at DESC
            "#,
        )
        .bind(org_id)
        .bind(start)
        .bind(end)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| BillingError::Database(e.to_string()))?;

        for row in instant_charges {
            records.push(BillingHistoryRecord {
                created_at: row.created_at,
                record_type: "instant_charge".to_string(),
                description: format!("Instant overage charge ({} units)", row.overage_amount),
                amount_cents: row.amount_cents,
                status: row.status,
                reference: row.stripe_invoice_id,
            });
        }

        // Get billing events (subscriptions, invoices, etc.)
        let events: Vec<BillingEventRow> = sqlx::query_as(
            r#"
            SELECT
                created_at,
                event_type,
                event_data,
                stripe_event_id,
                stripe_invoice_id
            FROM billing_events
            WHERE org_id = $1
              AND created_at >= $2
              AND created_at <= $3
              AND event_type IN ('INVOICE_PAID', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_CANCELED', 'CREDIT_APPLIED')
            ORDER BY created_at DESC
            "#
        )
        .bind(org_id)
        .bind(start)
        .bind(end)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default(); // billing_events might not exist in all deployments

        for row in events {
            let amount = row
                .event_data
                .get("amount_cents")
                .and_then(|v| v.as_i64())
                .unwrap_or(0) as i32;

            let description = match row.event_type.as_str() {
                "INVOICE_PAID" => "Invoice payment".to_string(),
                "SUBSCRIPTION_CREATED" => "Subscription created".to_string(),
                "SUBSCRIPTION_CANCELED" => "Subscription canceled".to_string(),
                "CREDIT_APPLIED" => "Credit applied".to_string(),
                _ => row.event_type.clone(),
            };

            records.push(BillingHistoryRecord {
                created_at: row.created_at,
                record_type: row.event_type.to_lowercase(),
                description,
                amount_cents: amount,
                status: "completed".to_string(),
                reference: row.stripe_invoice_id.or(row.stripe_event_id),
            });
        }

        // Sort by date descending
        records.sort_by(|a, b| b.created_at.cmp(&a.created_at));

        Ok(records)
    }

    /// Get billing summary for an organization
    pub async fn get_billing_summary(
        &self,
        org_id: Uuid,
        start_date: Option<OffsetDateTime>,
        end_date: Option<OffsetDateTime>,
    ) -> BillingResult<BillingSummary> {
        let records = self
            .get_billing_history(org_id, start_date, end_date)
            .await?;

        let mut total_charges = 0i64;
        let mut total_refunds = 0i64;
        let mut overage_charges = 0i64;
        let mut instant_charges = 0i64;
        let mut subscription_charges = 0i64;

        for record in &records {
            if record.amount_cents > 0 {
                total_charges += record.amount_cents as i64;

                match record.record_type.as_str() {
                    "overage" => overage_charges += record.amount_cents as i64,
                    "instant_charge" => instant_charges += record.amount_cents as i64,
                    "invoice_paid" => subscription_charges += record.amount_cents as i64,
                    _ => {}
                }
            } else {
                total_refunds += record.amount_cents.abs() as i64;
            }
        }

        Ok(BillingSummary {
            org_id,
            period_start: start_date
                .unwrap_or_else(|| OffsetDateTime::now_utc() - time::Duration::days(365)),
            period_end: end_date.unwrap_or_else(OffsetDateTime::now_utc),
            total_charges_cents: total_charges,
            total_refunds_cents: total_refunds,
            net_charges_cents: total_charges - total_refunds,
            overage_charges_cents: overage_charges,
            instant_charges_cents: instant_charges,
            subscription_charges_cents: subscription_charges,
            record_count: records.len(),
        })
    }
}

/// A billing history record
#[derive(Debug, Clone, Serialize)]
pub struct BillingHistoryRecord {
    pub created_at: OffsetDateTime,
    pub record_type: String,
    pub description: String,
    pub amount_cents: i32,
    pub status: String,
    pub reference: Option<String>,
}

/// Summary of billing for a period
#[derive(Debug, Clone, Serialize)]
pub struct BillingSummary {
    pub org_id: Uuid,
    pub period_start: OffsetDateTime,
    pub period_end: OffsetDateTime,
    pub total_charges_cents: i64,
    pub total_refunds_cents: i64,
    pub net_charges_cents: i64,
    pub overage_charges_cents: i64,
    pub instant_charges_cents: i64,
    pub subscription_charges_cents: i64,
    pub record_count: usize,
}

// Database row types
#[derive(sqlx::FromRow)]
struct TierChangeRow {
    created_at: OffsetDateTime,
    from_tier: String,
    to_tier: String,
    source: String,
    reason: Option<String>,
}

#[derive(sqlx::FromRow)]
struct OverageRow {
    created_at: OffsetDateTime,
    resource_type: String,
    overage_amount: i64,
    total_charge_cents: i32,
    status: String,
    stripe_invoice_item_id: Option<String>,
}

#[derive(sqlx::FromRow)]
struct RefundRow {
    created_at: OffsetDateTime,
    amount_cents: i32,
    refund_type: String,
    reason: Option<String>,
    status: String,
    stripe_refund_id: Option<String>,
}

#[derive(sqlx::FromRow)]
struct InstantChargeRow {
    created_at: OffsetDateTime,
    amount_cents: i32,
    overage_amount: i64,
    status: String,
    stripe_invoice_id: Option<String>,
}

#[derive(sqlx::FromRow)]
struct BillingEventRow {
    created_at: OffsetDateTime,
    event_type: String,
    event_data: serde_json::Value,
    stripe_event_id: Option<String>,
    stripe_invoice_id: Option<String>,
}

/// Escape a field for CSV output
fn escape_csv_field(field: &str) -> String {
    if field.contains(',') || field.contains('"') || field.contains('\n') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}
