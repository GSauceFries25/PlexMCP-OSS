//! Billing Events Module
//!
//! Provides append-only billing event logging for audit trails and debugging.
//! Events capture all billing operations and can be used to:
//! - Answer "why is this user on this tier?" questions
//! - Reconstruct billing history
//! - Compliance and audit requirements
//! - Pattern analysis and anomaly detection
//!
//! ## Event Types
//!
//! - Subscription lifecycle: created, updated, canceled
//! - Tier changes: immediate, scheduled, completed
//! - Invoicing: paid, failed, disputed
//! - Usage: credits applied, overages recorded, instant charges
//! - Spend caps: paused, unpaused
//! - Admin actions: overrides, manual changes

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::entitlement::EntitlementService;
use crate::error::BillingResult;

/// Types of billing events
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BillingEventType {
    // Subscription lifecycle
    SubscriptionCreated,
    SubscriptionUpdated,
    SubscriptionCanceled,

    // Tier changes
    TierChanged,
    TierChangeScheduled,
    TierChangeCompleted,

    // Trial
    TrialStarted,
    TrialEnding,
    TrialEnded,

    // Invoicing
    InvoiceCreated,
    InvoicePaid,
    InvoiceFailed,
    InvoiceUpcoming,

    // Charges
    CreditApplied,
    OverageRecorded,
    OverageCharged,
    InstantCharge,
    PaymentFailed,

    // Spend cap
    OrgPaused,
    OrgUnpaused,
    SpendCapSet,
    SpendCapThreshold,

    // Refunds and disputes
    RefundIssued,
    DisputeCreated,
    DisputeResolved,

    // Admin actions
    AdminOverride,
    EnterpriseLimitsSet,

    // Customer lifecycle
    CustomerCreated,
    CustomerUpdated,
    CustomerDeleted,

    // Subscription pause (voluntary)
    SubscriptionPaused,
    SubscriptionResumed,
}

impl std::fmt::Display for BillingEventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            BillingEventType::SubscriptionCreated => "SUBSCRIPTION_CREATED",
            BillingEventType::SubscriptionUpdated => "SUBSCRIPTION_UPDATED",
            BillingEventType::SubscriptionCanceled => "SUBSCRIPTION_CANCELED",
            BillingEventType::TierChanged => "TIER_CHANGED",
            BillingEventType::TierChangeScheduled => "TIER_CHANGE_SCHEDULED",
            BillingEventType::TierChangeCompleted => "TIER_CHANGE_COMPLETED",
            BillingEventType::TrialStarted => "TRIAL_STARTED",
            BillingEventType::TrialEnding => "TRIAL_ENDING",
            BillingEventType::TrialEnded => "TRIAL_ENDED",
            BillingEventType::InvoiceCreated => "INVOICE_CREATED",
            BillingEventType::InvoicePaid => "INVOICE_PAID",
            BillingEventType::InvoiceFailed => "INVOICE_FAILED",
            BillingEventType::InvoiceUpcoming => "INVOICE_UPCOMING",
            BillingEventType::CreditApplied => "CREDIT_APPLIED",
            BillingEventType::OverageRecorded => "OVERAGE_RECORDED",
            BillingEventType::OverageCharged => "OVERAGE_CHARGED",
            BillingEventType::InstantCharge => "INSTANT_CHARGE",
            BillingEventType::PaymentFailed => "PAYMENT_FAILED",
            BillingEventType::OrgPaused => "ORG_PAUSED",
            BillingEventType::OrgUnpaused => "ORG_UNPAUSED",
            BillingEventType::SpendCapSet => "SPEND_CAP_SET",
            BillingEventType::SpendCapThreshold => "SPEND_CAP_THRESHOLD",
            BillingEventType::RefundIssued => "REFUND_ISSUED",
            BillingEventType::DisputeCreated => "DISPUTE_CREATED",
            BillingEventType::DisputeResolved => "DISPUTE_RESOLVED",
            BillingEventType::AdminOverride => "ADMIN_OVERRIDE",
            BillingEventType::EnterpriseLimitsSet => "ENTERPRISE_LIMITS_SET",
            BillingEventType::CustomerCreated => "CUSTOMER_CREATED",
            BillingEventType::CustomerUpdated => "CUSTOMER_UPDATED",
            BillingEventType::CustomerDeleted => "CUSTOMER_DELETED",
            BillingEventType::SubscriptionPaused => "SUBSCRIPTION_PAUSED",
            BillingEventType::SubscriptionResumed => "SUBSCRIPTION_RESUMED",
        };
        write!(f, "{}", s)
    }
}

/// Who triggered the event
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActorType {
    /// End user through UI
    User,
    /// Admin user
    Admin,
    /// System automation
    System,
    /// Stripe webhook
    Stripe,
}

impl std::fmt::Display for ActorType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ActorType::User => write!(f, "user"),
            ActorType::Admin => write!(f, "admin"),
            ActorType::System => write!(f, "system"),
            ActorType::Stripe => write!(f, "stripe"),
        }
    }
}

/// A billing event record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingEvent {
    pub id: Uuid,
    pub org_id: Uuid,
    pub event_type: String,
    pub event_subtype: Option<String>,
    pub event_data: serde_json::Value,
    pub stripe_event_id: Option<String>,
    pub stripe_invoice_id: Option<String>,
    pub stripe_subscription_id: Option<String>,
    pub stripe_customer_id: Option<String>,
    pub actor_id: Option<Uuid>,
    pub actor_type: String,
    pub entitlement_snapshot: Option<serde_json::Value>,
    pub created_at: OffsetDateTime,
}

/// Builder for creating billing events
pub struct BillingEventBuilder {
    org_id: Uuid,
    event_type: BillingEventType,
    event_subtype: Option<String>,
    event_data: serde_json::Value,
    stripe_event_id: Option<String>,
    stripe_invoice_id: Option<String>,
    stripe_subscription_id: Option<String>,
    stripe_customer_id: Option<String>,
    actor_id: Option<Uuid>,
    actor_type: ActorType,
}

impl BillingEventBuilder {
    /// Create a new event builder
    pub fn new(org_id: Uuid, event_type: BillingEventType) -> Self {
        Self {
            org_id,
            event_type,
            event_subtype: None,
            event_data: serde_json::json!({}),
            stripe_event_id: None,
            stripe_invoice_id: None,
            stripe_subscription_id: None,
            stripe_customer_id: None,
            actor_id: None,
            actor_type: ActorType::System,
        }
    }

    /// Set the event subtype
    pub fn subtype(mut self, subtype: impl Into<String>) -> Self {
        self.event_subtype = Some(subtype.into());
        self
    }

    /// Set the event data
    pub fn data(mut self, data: serde_json::Value) -> Self {
        self.event_data = data;
        self
    }

    /// Set the Stripe event ID
    pub fn stripe_event(mut self, event_id: impl Into<String>) -> Self {
        self.stripe_event_id = Some(event_id.into());
        self
    }

    /// Set the Stripe invoice ID
    pub fn stripe_invoice(mut self, invoice_id: impl Into<String>) -> Self {
        self.stripe_invoice_id = Some(invoice_id.into());
        self
    }

    /// Set the Stripe subscription ID
    pub fn stripe_subscription(mut self, subscription_id: impl Into<String>) -> Self {
        self.stripe_subscription_id = Some(subscription_id.into());
        self
    }

    /// Set the Stripe customer ID
    pub fn stripe_customer(mut self, customer_id: impl Into<String>) -> Self {
        self.stripe_customer_id = Some(customer_id.into());
        self
    }

    /// Set the actor (user who triggered the event)
    pub fn actor(mut self, actor_id: Uuid, actor_type: ActorType) -> Self {
        self.actor_id = Some(actor_id);
        self.actor_type = actor_type;
        self
    }

    /// Set the actor with an optional user ID
    pub fn actor_opt(mut self, actor_id: Option<Uuid>, actor_type: ActorType) -> Self {
        self.actor_id = actor_id;
        self.actor_type = actor_type;
        self
    }

    /// Set the actor type without a specific user
    pub fn actor_type(mut self, actor_type: ActorType) -> Self {
        self.actor_type = actor_type;
        self
    }
}

/// Service for logging and querying billing events
pub struct BillingEventLogger {
    pool: PgPool,
    entitlement_service: EntitlementService,
}

impl BillingEventLogger {
    pub fn new(pool: PgPool) -> Self {
        Self {
            entitlement_service: EntitlementService::new(pool.clone()),
            pool,
        }
    }

    /// Log a billing event with entitlement snapshot
    pub async fn log_event(&self, builder: BillingEventBuilder) -> BillingResult<Uuid> {
        // Capture entitlement snapshot for debugging
        let entitlement_snapshot = match self
            .entitlement_service
            .compute_entitlement(builder.org_id)
            .await
        {
            Ok(e) => Some(serde_json::to_value(&e).unwrap_or(serde_json::json!({}))),
            Err(_) => None,
        };

        let event_id = self
            .log_event_with_snapshot(builder, entitlement_snapshot)
            .await?;

        Ok(event_id)
    }

    /// Log a billing event with a pre-computed entitlement snapshot
    pub async fn log_event_with_snapshot(
        &self,
        builder: BillingEventBuilder,
        entitlement_snapshot: Option<serde_json::Value>,
    ) -> BillingResult<Uuid> {
        let event_id: (Uuid,) = sqlx::query_as(
            r#"
            INSERT INTO billing_events (
                org_id,
                event_type,
                event_subtype,
                event_data,
                stripe_event_id,
                stripe_invoice_id,
                stripe_subscription_id,
                stripe_customer_id,
                actor_id,
                actor_type,
                entitlement_snapshot
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
            "#,
        )
        .bind(builder.org_id)
        .bind(builder.event_type.to_string())
        .bind(&builder.event_subtype)
        .bind(&builder.event_data)
        .bind(&builder.stripe_event_id)
        .bind(&builder.stripe_invoice_id)
        .bind(&builder.stripe_subscription_id)
        .bind(&builder.stripe_customer_id)
        .bind(builder.actor_id)
        .bind(builder.actor_type.to_string())
        .bind(&entitlement_snapshot)
        .fetch_one(&self.pool)
        .await?;

        Ok(event_id.0)
    }

    /// Log an event without capturing entitlement (faster, for high-frequency events)
    pub async fn log_event_no_snapshot(&self, builder: BillingEventBuilder) -> BillingResult<Uuid> {
        self.log_event_with_snapshot(builder, None).await
    }

    /// Get recent events for an organization
    pub async fn get_events_for_org(
        &self,
        org_id: Uuid,
        limit: i64,
    ) -> BillingResult<Vec<BillingEvent>> {
        let events: Vec<BillingEvent> = sqlx::query_as(
            r#"
            SELECT
                id,
                org_id,
                event_type,
                event_subtype,
                event_data,
                stripe_event_id,
                stripe_invoice_id,
                stripe_subscription_id,
                stripe_customer_id,
                actor_id,
                actor_type,
                entitlement_snapshot,
                created_at
            FROM billing_events
            WHERE org_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            "#,
        )
        .bind(org_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(events)
    }

    /// Get events by type for an organization
    pub async fn get_events_by_type(
        &self,
        org_id: Uuid,
        event_type: BillingEventType,
        limit: i64,
    ) -> BillingResult<Vec<BillingEvent>> {
        let events: Vec<BillingEvent> = sqlx::query_as(
            r#"
            SELECT
                id,
                org_id,
                event_type,
                event_subtype,
                event_data,
                stripe_event_id,
                stripe_invoice_id,
                stripe_subscription_id,
                stripe_customer_id,
                actor_id,
                actor_type,
                entitlement_snapshot,
                created_at
            FROM billing_events
            WHERE org_id = $1 AND event_type = $2
            ORDER BY created_at DESC
            LIMIT $3
            "#,
        )
        .bind(org_id)
        .bind(event_type.to_string())
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(events)
    }

    /// Get events related to a specific Stripe subscription
    pub async fn get_events_for_subscription(
        &self,
        stripe_subscription_id: &str,
        limit: i64,
    ) -> BillingResult<Vec<BillingEvent>> {
        let events: Vec<BillingEvent> = sqlx::query_as(
            r#"
            SELECT
                id,
                org_id,
                event_type,
                event_subtype,
                event_data,
                stripe_event_id,
                stripe_invoice_id,
                stripe_subscription_id,
                stripe_customer_id,
                actor_id,
                actor_type,
                entitlement_snapshot,
                created_at
            FROM billing_events
            WHERE stripe_subscription_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            "#,
        )
        .bind(stripe_subscription_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(events)
    }
}

// Implement FromRow for BillingEvent
impl<'r> sqlx::FromRow<'r, sqlx::postgres::PgRow> for BillingEvent {
    fn from_row(row: &'r sqlx::postgres::PgRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(Self {
            id: row.try_get("id")?,
            org_id: row.try_get("org_id")?,
            event_type: row.try_get("event_type")?,
            event_subtype: row.try_get("event_subtype")?,
            event_data: row.try_get("event_data")?,
            stripe_event_id: row.try_get("stripe_event_id")?,
            stripe_invoice_id: row.try_get("stripe_invoice_id")?,
            stripe_subscription_id: row.try_get("stripe_subscription_id")?,
            stripe_customer_id: row.try_get("stripe_customer_id")?,
            actor_id: row.try_get("actor_id")?,
            actor_type: row.try_get("actor_type")?,
            entitlement_snapshot: row.try_get("entitlement_snapshot")?,
            created_at: row.try_get("created_at")?,
        })
    }
}

/// Convenience functions for common event logging scenarios
impl BillingEventLogger {
    /// Log a tier change event
    pub async fn log_tier_change(
        &self,
        org_id: Uuid,
        from_tier: &str,
        to_tier: &str,
        actor_id: Option<Uuid>,
        actor_type: ActorType,
        reason: Option<&str>,
        stripe_subscription_id: Option<&str>,
    ) -> BillingResult<Uuid> {
        let mut builder = BillingEventBuilder::new(org_id, BillingEventType::TierChanged)
            .data(serde_json::json!({
                "from_tier": from_tier,
                "to_tier": to_tier,
                "reason": reason,
            }))
            .actor_type(actor_type);

        if let Some(actor) = actor_id {
            builder = builder.actor(actor, actor_type);
        }

        if let Some(sub_id) = stripe_subscription_id {
            builder = builder.stripe_subscription(sub_id);
        }

        self.log_event(builder).await
    }

    /// Log a subscription created event (from Stripe webhook)
    pub async fn log_subscription_created(
        &self,
        org_id: Uuid,
        stripe_event_id: &str,
        stripe_subscription_id: &str,
        stripe_customer_id: &str,
        tier: &str,
    ) -> BillingResult<Uuid> {
        let builder = BillingEventBuilder::new(org_id, BillingEventType::SubscriptionCreated)
            .data(serde_json::json!({
                "tier": tier,
            }))
            .stripe_event(stripe_event_id)
            .stripe_subscription(stripe_subscription_id)
            .stripe_customer(stripe_customer_id)
            .actor_type(ActorType::Stripe);

        self.log_event(builder).await
    }

    /// Log an invoice paid event
    pub async fn log_invoice_paid(
        &self,
        org_id: Uuid,
        stripe_event_id: &str,
        stripe_invoice_id: &str,
        amount_paid_cents: i64,
    ) -> BillingResult<Uuid> {
        let builder = BillingEventBuilder::new(org_id, BillingEventType::InvoicePaid)
            .data(serde_json::json!({
                "amount_paid_cents": amount_paid_cents,
            }))
            .stripe_event(stripe_event_id)
            .stripe_invoice(stripe_invoice_id)
            .actor_type(ActorType::Stripe);

        self.log_event(builder).await
    }

    /// Log an organization pause due to spend cap
    pub async fn log_org_paused(
        &self,
        org_id: Uuid,
        current_spend_cents: i64,
        cap_amount_cents: i64,
    ) -> BillingResult<Uuid> {
        let builder = BillingEventBuilder::new(org_id, BillingEventType::OrgPaused)
            .data(serde_json::json!({
                "current_spend_cents": current_spend_cents,
                "cap_amount_cents": cap_amount_cents,
                "spend_percentage": (current_spend_cents as f64 / cap_amount_cents as f64) * 100.0,
            }))
            .actor_type(ActorType::System);

        self.log_event(builder).await
    }

    /// Log an admin override action
    pub async fn log_admin_override(
        &self,
        org_id: Uuid,
        admin_id: Uuid,
        action: &str,
        details: serde_json::Value,
    ) -> BillingResult<Uuid> {
        let builder = BillingEventBuilder::new(org_id, BillingEventType::AdminOverride)
            .data(serde_json::json!({
                "action": action,
                "details": details,
            }))
            .actor(admin_id, ActorType::Admin);

        self.log_event(builder).await
    }

    /// Log a dispute created event
    pub async fn log_dispute_created(
        &self,
        org_id: Uuid,
        stripe_event_id: &str,
        dispute_id: &str,
        amount_cents: i64,
        reason: &str,
    ) -> BillingResult<Uuid> {
        let builder = BillingEventBuilder::new(org_id, BillingEventType::DisputeCreated)
            .data(serde_json::json!({
                "dispute_id": dispute_id,
                "amount_cents": amount_cents,
                "reason": reason,
            }))
            .stripe_event(stripe_event_id)
            .actor_type(ActorType::Stripe);

        self.log_event(builder).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_billing_event_type_display() {
        assert_eq!(
            BillingEventType::SubscriptionCreated.to_string(),
            "SUBSCRIPTION_CREATED"
        );
        assert_eq!(BillingEventType::TierChanged.to_string(), "TIER_CHANGED");
        assert_eq!(BillingEventType::OrgPaused.to_string(), "ORG_PAUSED");
    }

    #[test]
    fn test_actor_type_display() {
        assert_eq!(ActorType::User.to_string(), "user");
        assert_eq!(ActorType::Admin.to_string(), "admin");
        assert_eq!(ActorType::System.to_string(), "system");
        assert_eq!(ActorType::Stripe.to_string(), "stripe");
    }

    #[test]
    fn test_event_builder() {
        let org_id = Uuid::new_v4();
        let builder = BillingEventBuilder::new(org_id, BillingEventType::TierChanged)
            .data(serde_json::json!({"test": true}))
            .stripe_subscription("sub_123")
            .actor_type(ActorType::Admin);

        assert_eq!(builder.org_id, org_id);
        assert_eq!(builder.event_type, BillingEventType::TierChanged);
        assert_eq!(builder.stripe_subscription_id, Some("sub_123".to_string()));
        assert_eq!(builder.actor_type, ActorType::Admin);
    }
}
