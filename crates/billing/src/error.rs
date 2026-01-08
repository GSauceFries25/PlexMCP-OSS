//! Billing error types

use thiserror::Error;

/// Billing-specific errors
#[derive(Debug, Error)]
pub enum BillingError {
    #[error("Stripe API error: {0}")]
    StripeApi(String),

    #[error("Customer not found: {0}")]
    CustomerNotFound(String),

    #[error("Subscription not found: {0}")]
    SubscriptionNotFound(String),

    #[error("Invalid subscription tier: {0}")]
    InvalidTier(String),

    #[error("Webhook signature verification failed")]
    WebhookSignatureInvalid,

    #[error("Webhook event type not supported: {0}")]
    WebhookEventNotSupported(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Resource already exists: {0}")]
    AlreadyExists(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Payment method required for this operation")]
    PaymentMethodRequired,

    #[error("No cancelled subscription found for organization: {0}")]
    NoCancelledSubscription(String),

    #[error("No customer found for organization")]
    NoCustomer,

    #[error("Outstanding overages ({overage_cents} cents) exceed credit ({credit_cents} cents). Pay overages first at: {pay_first_url}")]
    OveragesExceedCredit {
        overage_cents: i64,
        credit_cents: i64,
        pay_first_url: String,
    },

    #[error("Refund failed: {0}")]
    RefundFailed(String),

    #[error("No refundable charge found for this subscription")]
    NoRefundableCharge,

    #[error("Refund amount ({requested_cents} cents) exceeds refundable amount ({available_cents} cents)")]
    RefundAmountExceedsCharge {
        requested_cents: i64,
        available_cents: i64,
    },

    #[error("Charge is too old to refund (Stripe allows refunds within ~90 days)")]
    ChargeExpiredForRefund,

    #[error("Payment required for subscription. Use checkout flow instead.")]
    UseCheckoutFlow {
        /// Pre-created Stripe checkout URL (if available)
        checkout_url: Option<String>,
        /// Credit being applied in cents
        credit_cents: i64,
        /// Coupon ID to apply (if coupon was created)
        coupon_id: Option<String>,
        /// Target tier for subscription
        tier: String,
        /// Billing interval (monthly/annual)
        billing_interval: String,
        /// Stripe customer ID for checkout
        customer_id: String,
    },

    #[error("Concurrent modification detected: {0}")]
    ConcurrentModification(String),

    #[error("Invalid amount: {0}")]
    InvalidAmount(String),

    #[error("Subscription required: {0}")]
    SubscriptionRequired(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),
}

impl From<stripe::StripeError> for BillingError {
    fn from(err: stripe::StripeError) -> Self {
        BillingError::StripeApi(err.to_string())
    }
}

impl From<sqlx::Error> for BillingError {
    fn from(err: sqlx::Error) -> Self {
        BillingError::Database(err.to_string())
    }
}

pub type BillingResult<T> = Result<T, BillingError>;
