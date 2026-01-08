//! Billing routes for Stripe integration

use axum::{
    extract::{Extension, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use stripe::{Invoice, InvoiceId};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    audit_constants::{admin_action, event_type, severity, target_type},
    auth::AuthUser,
    error::ApiError,
    state::AppState,
};

/// Request to create a checkout session
#[derive(Debug, Deserialize)]
pub struct CreateCheckoutRequest {
    pub tier: String,
    /// If true, this is an upgrade from an existing paid subscription
    /// and pending overages should be included in the checkout
    #[serde(default)]
    pub is_upgrade: bool,
    /// Billing interval (monthly or annual)
    pub billing_interval: Option<String>,
}

/// Response from creating a checkout session
#[derive(Debug, Serialize)]
pub struct CheckoutResponse {
    pub session_id: String,
    pub url: Option<String>,
}

/// Response from creating a portal session
#[derive(Debug, Serialize)]
pub struct PortalResponse {
    pub portal_url: String,
}

/// Subscription info response
#[derive(Debug, Serialize)]
pub struct SubscriptionInfo {
    pub status: String,
    pub tier: String,
    pub current_period_start: Option<String>,
    pub current_period_end: Option<String>,
    pub cancel_at_period_end: bool,
    /// If a downgrade is scheduled, this contains the target tier
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_downgrade: Option<ScheduledDowngradeInfo>,
}

/// Info about a scheduled downgrade
#[derive(Debug, Serialize)]
pub struct ScheduledDowngradeInfo {
    pub to_tier: String,
    pub effective_date: String,
}

/// Request to preview proration for subscription upgrade
#[derive(Debug, Deserialize)]
pub struct ProrationPreviewRequest {
    pub tier: String,
}

/// Response for proration preview
#[derive(Debug, Serialize)]
pub struct ProrationPreviewResponse {
    pub current_tier: String,
    pub new_tier: String,
    pub proration_amount_cents: i64,
    pub overage_amount_cents: i64,
    pub total_amount_cents: i64,
    pub days_remaining: i32,
    pub description: String,
}

/// Preview the proration for upgrading to a new tier
/// Returns the prorated amount that would be charged
pub async fn preview_proration(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(req): Query<ProrationPreviewRequest>,
) -> Result<Json<ProrationPreviewResponse>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    let preview = billing
        .subscriptions
        .preview_upgrade_proration(org_id, &req.tier)
        .await
        .map_err(|e| {
            tracing::error!(
                org_id = %org_id,
                tier = %req.tier,
                error = %e,
                error_debug = ?e,
                "preview_proration failed"
            );
            ApiError::Database(format!("Failed to preview proration: {}", e))
        })?;

    Ok(Json(ProrationPreviewResponse {
        current_tier: preview.current_tier,
        new_tier: preview.new_tier,
        proration_amount_cents: preview.proration_amount_cents,
        overage_amount_cents: preview.overage_amount_cents,
        total_amount_cents: preview.total_amount_cents,
        days_remaining: preview.days_remaining,
        description: preview.description,
    }))
}

/// Create a checkout session for subscription
pub async fn create_checkout(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<CreateCheckoutRequest>,
) -> Result<Json<CheckoutResponse>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    // Get org's Stripe customer ID
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let email = auth_user.email.as_deref().unwrap_or("");
    let customer_id = get_or_create_customer(&state, billing, org_id, email).await?;

    // Parse billing interval
    let billing_interval = req
        .billing_interval
        .as_deref()
        .and_then(plexmcp_billing::BillingInterval::from_str)
        .unwrap_or_default();

    // Use upgrade checkout if this is an upgrade from existing subscription
    // This will include pending overages in the checkout total
    let session = if req.is_upgrade {
        tracing::info!(
            org_id = %org_id,
            tier = %req.tier,
            "Creating upgrade checkout session with pending overages"
        );
        billing
            .checkout
            .create_upgrade_checkout_with_interval(
                org_id,
                &customer_id,
                &req.tier,
                billing_interval,
            )
            .await
            .map_err(|e| ApiError::Database(format!("Failed to create upgrade checkout: {}", e)))?
    } else {
        billing
            .checkout
            .create_subscription_checkout_with_interval(
                org_id,
                &customer_id,
                &req.tier,
                billing_interval,
            )
            .await
            .map_err(|e| ApiError::Database(format!("Failed to create checkout: {}", e)))?
    };

    Ok(Json(CheckoutResponse {
        session_id: session.id.to_string(),
        url: session.url,
    }))
}

/// Create a billing portal session
pub async fn create_portal_session(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<PortalResponse>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    // Get org's Stripe customer ID (create if needed)
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let email = auth_user.email.as_deref().unwrap_or("");
    let customer_id = get_or_create_customer(&state, billing, org_id, email).await?;

    let session = billing
        .portal
        .create_portal_session(org_id, &customer_id)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to create portal session: {}", e)))?;

    Ok(Json(PortalResponse {
        portal_url: session.url,
    }))
}

/// Get current subscription info
pub async fn get_subscription(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<SubscriptionInfo>, ApiError> {
    tracing::info!("get_subscription: starting");

    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    tracing::info!(org_id = %org_id, "get_subscription: got org_id");

    // Get the org's subscription tier from the database as fallback
    let db_tier: Option<(String,)> =
        sqlx::query_as("SELECT subscription_tier FROM organizations WHERE id = $1")
            .bind(org_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "get_subscription: failed to get org tier");
                ApiError::Database(format!("Failed to get org tier: {}", e))
            })?;
    let fallback_tier = db_tier.map(|(t,)| t).unwrap_or_else(|| "free".to_string());
    tracing::info!(fallback_tier = %fallback_tier, "get_subscription: got fallback tier");

    let subscription = billing
        .subscriptions
        .get_subscription(org_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "get_subscription: failed to get stripe subscription");
            ApiError::Database(format!("Failed to get subscription: {}", e))
        })?;
    tracing::info!(
        has_subscription = subscription.is_some(),
        "get_subscription: got stripe subscription result"
    );

    // Check for scheduled downgrade
    let scheduled_downgrade = billing
        .subscriptions
        .get_scheduled_downgrade(org_id)
        .await
        .ok()
        .flatten()
        .map(|d| ScheduledDowngradeInfo {
            to_tier: d.new_tier,
            effective_date: d
                .effective_date
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        });

    // If we have a Stripe subscription, use it; otherwise return info from database tier
    let info = match subscription {
        Some(sub) => {
            // When subscription is canceled, use the database tier (which reflects admin changes)
            // Otherwise, try to get tier from Stripe price ID
            let is_canceled = sub.status == stripe::SubscriptionStatus::Canceled;
            let tier = if is_canceled {
                // Use database tier for canceled subscriptions (admin may have changed it)
                fallback_tier.clone()
            } else {
                // For active subscriptions, use Stripe price ID or fallback to database tier
                sub.items
                    .data
                    .first()
                    .and_then(|item| item.price.as_ref())
                    .and_then(|price| {
                        billing
                            .subscriptions
                            .stripe()
                            .config()
                            .tier_for_price_id(price.id.as_str())
                    })
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| fallback_tier.clone())
            };

            // For canceled subscriptions with free tier, return as if no subscription exists
            if is_canceled && fallback_tier == "free" {
                SubscriptionInfo {
                    status: "canceled".to_string(),
                    tier: "free".to_string(),
                    current_period_start: None,
                    current_period_end: None,
                    cancel_at_period_end: false,
                    scheduled_downgrade: None,
                }
            } else {
                SubscriptionInfo {
                    status: format!("{:?}", sub.status).to_lowercase(),
                    tier,
                    current_period_start: Some(
                        time::OffsetDateTime::from_unix_timestamp(sub.current_period_start)
                            .map(|t| {
                                t.format(&time::format_description::well_known::Rfc3339)
                                    .unwrap_or_default()
                            })
                            .unwrap_or_default(),
                    ),
                    current_period_end: Some(
                        time::OffsetDateTime::from_unix_timestamp(sub.current_period_end)
                            .map(|t| {
                                t.format(&time::format_description::well_known::Rfc3339)
                                    .unwrap_or_default()
                            })
                            .unwrap_or_default(),
                    ),
                    cancel_at_period_end: sub.cancel_at_period_end,
                    scheduled_downgrade,
                }
            }
        }
        None => {
            // No Stripe subscription - return info from database tier
            SubscriptionInfo {
                status: "active".to_string(),
                tier: fallback_tier,
                current_period_start: None,
                current_period_end: None,
                cancel_at_period_end: false,
                scheduled_downgrade: None,
            }
        }
    };

    Ok(Json(info))
}

/// Update subscription tier
#[derive(Debug, Deserialize)]
pub struct UpdateSubscriptionRequest {
    pub tier: String,
}

pub async fn update_subscription(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<UpdateSubscriptionRequest>,
) -> Result<Json<SubscriptionInfo>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let user_id = auth_user.user_id;

    // Get old tier for audit logging (SOC 2 CC5.2)
    let old_tier: Option<(String,)> =
        sqlx::query_as("SELECT subscription_tier FROM organizations WHERE id = $1")
            .bind(org_id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    let old_tier_str = old_tier.map(|(t,)| t).unwrap_or_else(|| "free".to_string());

    // Auto-bill any pending overages before tier change
    // This ensures a clean slate for the new tier and avoids surprise charges later
    if let Ok(accumulated) = billing.overage.get_accumulated_overage(org_id).await {
        if accumulated.total_cents > 0 {
            // Get customer ID to bill overages
            match get_customer_id(&state, org_id).await {
                Ok(Some(customer_id)) => {
                    match billing.overage.pay_overages_now(org_id, &customer_id).await {
                        Ok(result) => {
                            tracing::info!(
                                org_id = %org_id,
                                amount_cents = accumulated.total_cents,
                                result = ?result,
                                "Auto-billed pending overages before subscription upgrade"
                            );
                        }
                        Err(e) => {
                            // Log warning but continue with upgrade - overages will be billed at period end
                            tracing::warn!(
                                org_id = %org_id,
                                error = %e,
                                "Failed to auto-bill overages before upgrade, continuing anyway"
                            );
                        }
                    }
                }
                Ok(None) => {
                    tracing::warn!(
                        org_id = %org_id,
                        "No customer ID found for overage billing before upgrade"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        org_id = %org_id,
                        error = %e,
                        "Failed to get customer ID for overage billing"
                    );
                }
            }
        }
    }

    let subscription = billing.subscriptions
        .update_subscription(org_id, &req.tier)
        .await
        .map_err(|e| {
            // Check if this is a payment method required error
            if matches!(e, plexmcp_billing::BillingError::PaymentMethodRequired) {
                tracing::info!(
                    org_id = %org_id,
                    tier = %req.tier,
                    "Subscription update requires payment method - redirecting to checkout"
                );
                return ApiError::BadRequest(
                    "PAYMENT_METHOD_REQUIRED: No payment method on file. Please use checkout to add payment information.".to_string()
                );
            }
            ApiError::Database(format!("Failed to update subscription: {}", e))
        })?;

    let tier = subscription
        .items
        .data
        .first()
        .and_then(|item| item.price.as_ref())
        .and_then(|price| {
            billing
                .subscriptions
                .stripe()
                .config()
                .tier_for_price_id(price.id.as_str())
        })
        .map(|s| s.to_string())
        .unwrap_or_else(|| req.tier.clone());

    // SOC 2 CC5.2: Audit log subscription tier change
    let audit_details = serde_json::json!({
        "org_id": org_id.to_string(),
        "old_tier": old_tier_str,
        "new_tier": tier,
        "stripe_subscription_id": subscription.id.to_string(),
    });
    let _ = sqlx::query(
        r#"INSERT INTO admin_audit_log (
            admin_user_id, action, target_type, target_id, details,
            event_type, severity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
    )
    .bind(user_id)
    .bind(admin_action::SUBSCRIPTION_CHANGED)
    .bind(target_type::ORGANIZATION)
    .bind(org_id)
    .bind(&audit_details)
    .bind(event_type::ADMIN_ACTION)
    .bind(severity::INFO)
    .execute(&state.pool)
    .await;

    tracing::info!(
        org_id = %org_id,
        old_tier = %old_tier_str,
        new_tier = %tier,
        user_id = ?user_id,
        "Subscription tier changed"
    );

    Ok(Json(SubscriptionInfo {
        status: format!("{:?}", subscription.status).to_lowercase(),
        tier,
        current_period_start: Some(
            time::OffsetDateTime::from_unix_timestamp(subscription.current_period_start)
                .map(|t| {
                    t.format(&time::format_description::well_known::Rfc3339)
                        .unwrap_or_default()
                })
                .unwrap_or_default(),
        ),
        current_period_end: Some(
            time::OffsetDateTime::from_unix_timestamp(subscription.current_period_end)
                .map(|t| {
                    t.format(&time::format_description::well_known::Rfc3339)
                        .unwrap_or_default()
                })
                .unwrap_or_default(),
        ),
        cancel_at_period_end: subscription.cancel_at_period_end,
        scheduled_downgrade: None, // Just upgraded, no downgrade scheduled
    }))
}

/// Cancel subscription
pub async fn cancel_subscription(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<StatusCode, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let user_id = auth_user.user_id;

    // Check current subscription status first - make cancel idempotent
    // This prevents 404 errors when user clicks "Cancel" on already-cancelled subscription
    let subscription = billing
        .subscriptions
        .get_subscription(org_id)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to get subscription: {}", e)))?;

    // Return success if no subscription or already cancelled (idempotent)
    if let Some(sub) = &subscription {
        if sub.status == stripe::SubscriptionStatus::Canceled {
            tracing::info!(
                org_id = %org_id,
                "Cancel subscription called on already-cancelled subscription (idempotent success)"
            );
            return Ok(StatusCode::NO_CONTENT);
        }
    } else {
        // No subscription found - return success (nothing to cancel)
        tracing::info!(
            org_id = %org_id,
            "Cancel subscription called but no subscription exists (idempotent success)"
        );
        return Ok(StatusCode::NO_CONTENT);
    }

    // Get current tier for audit logging (SOC 2 CC5.2)
    let current_tier: Option<(String,)> =
        sqlx::query_as("SELECT subscription_tier FROM organizations WHERE id = $1")
            .bind(org_id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    let tier_str = current_tier
        .map(|(t,)| t)
        .unwrap_or_else(|| "unknown".to_string());

    billing
        .subscriptions
        .cancel_subscription(org_id)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to cancel subscription: {}", e)))?;

    // SOC 2 CC5.2: Audit log subscription cancellation
    let audit_details = serde_json::json!({
        "org_id": org_id.to_string(),
        "tier": tier_str,
        "action": "cancel_at_period_end",
    });
    let _ = sqlx::query(
        r#"INSERT INTO admin_audit_log (
            admin_user_id, action, target_type, target_id, details,
            event_type, severity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
    )
    .bind(user_id)
    .bind(admin_action::SUBSCRIPTION_CANCELED)
    .bind(target_type::ORGANIZATION)
    .bind(org_id)
    .bind(&audit_details)
    .bind(event_type::ADMIN_ACTION)
    .bind(severity::WARNING)
    .execute(&state.pool)
    .await;

    tracing::info!(
        org_id = %org_id,
        tier = %tier_str,
        user_id = ?user_id,
        "Subscription cancellation scheduled"
    );

    Ok(StatusCode::NO_CONTENT)
}

/// Resume a cancelled subscription
pub async fn resume_subscription(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<SubscriptionInfo>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    let subscription = billing
        .subscriptions
        .resume_subscription(org_id)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to resume subscription: {}", e)))?;

    let tier = subscription
        .items
        .data
        .first()
        .and_then(|item| item.price.as_ref())
        .and_then(|price| {
            billing
                .subscriptions
                .stripe()
                .config()
                .tier_for_price_id(price.id.as_str())
        })
        .map(|s| s.to_string())
        .unwrap_or_else(|| "unknown".to_string());

    Ok(Json(SubscriptionInfo {
        status: format!("{:?}", subscription.status).to_lowercase(),
        tier,
        current_period_start: Some(
            time::OffsetDateTime::from_unix_timestamp(subscription.current_period_start)
                .map(|t| {
                    t.format(&time::format_description::well_known::Rfc3339)
                        .unwrap_or_default()
                })
                .unwrap_or_default(),
        ),
        current_period_end: Some(
            time::OffsetDateTime::from_unix_timestamp(subscription.current_period_end)
                .map(|t| {
                    t.format(&time::format_description::well_known::Rfc3339)
                        .unwrap_or_default()
                })
                .unwrap_or_default(),
        ),
        cancel_at_period_end: subscription.cancel_at_period_end,
        scheduled_downgrade: None, // Resumed, no downgrade scheduled
    }))
}

/// Request to reactivate a cancelled subscription
#[derive(Debug, Deserialize)]
pub struct ReactivateSubscriptionRequest {
    pub tier: String,
    #[serde(default = "default_billing_interval")]
    pub billing_interval: String,
}

fn default_billing_interval() -> String {
    "monthly".to_string()
}

/// Response from reactivating a subscription
#[derive(Debug, Serialize)]
pub struct ReactivationResponse {
    pub status: String,
    pub tier: String,
    pub billing_interval: String,
    pub credit_applied_cents: i64,
    pub extra_trial_days: i32,
    pub overages_deducted_cents: i64,
    pub current_period_end: String,
    pub trial_end: Option<String>,
    pub message: String,
}

/// Reactivate a cancelled subscription with proration credit
pub async fn reactivate_subscription(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<ReactivateSubscriptionRequest>,
) -> Result<Json<ReactivationResponse>, ApiError> {
    // DEBUG: Log entry to handler
    tracing::info!(
        has_org_id = auth_user.org_id.is_some(),
        tier = %req.tier,
        billing_interval = %req.billing_interval,
        "Reactivate subscription handler entered"
    );

    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let user_id = auth_user.user_id;

    tracing::info!(
        org_id = %org_id,
        tier = %req.tier,
        billing_interval = %req.billing_interval,
        "Reactivating cancelled subscription"
    );

    let reactivation_result = billing
        .subscriptions
        .reactivate_subscription(org_id, &req.tier, &req.billing_interval)
        .await;

    // Handle UseCheckoutFlow specially since it requires async checkout creation
    let result = match reactivation_result {
        Ok(result) => result,
        Err(plexmcp_billing::BillingError::UseCheckoutFlow {
            checkout_url: _,
            credit_cents,
            coupon_id,
            tier,
            billing_interval: interval,
            customer_id,
        }) => {
            // Create actual Stripe checkout session
            let billing_interval = plexmcp_billing::BillingInterval::from_str(&interval)
                .unwrap_or(plexmcp_billing::BillingInterval::Monthly);

            let checkout_url = if let Some(coupon) = coupon_id {
                // Create checkout with coupon
                match billing
                    .checkout
                    .create_subscription_checkout_with_coupon(
                        org_id,
                        &customer_id,
                        &tier,
                        billing_interval,
                        &coupon,
                    )
                    .await
                {
                    Ok(session) => session.url.unwrap_or_default(),
                    Err(e) => {
                        tracing::error!(error = %e, "Failed to create checkout with coupon");
                        // Fallback to regular checkout
                        match billing
                            .checkout
                            .create_subscription_checkout_with_interval(
                                org_id,
                                &customer_id,
                                &tier,
                                billing_interval,
                            )
                            .await
                        {
                            Ok(session) => session.url.unwrap_or_default(),
                            Err(e) => {
                                return Err(ApiError::BadRequest(format!(
                                    "Failed to create checkout: {}",
                                    e
                                )));
                            }
                        }
                    }
                }
            } else {
                // Create checkout without coupon
                match billing
                    .checkout
                    .create_subscription_checkout_with_interval(
                        org_id,
                        &customer_id,
                        &tier,
                        billing_interval,
                    )
                    .await
                {
                    Ok(session) => session.url.unwrap_or_default(),
                    Err(e) => {
                        return Err(ApiError::BadRequest(format!(
                            "Failed to create checkout: {}",
                            e
                        )));
                    }
                }
            };

            return Err(ApiError::BadRequest(
                serde_json::json!({
                    "code": "USE_CHECKOUT_FLOW",
                    "message": "Partial credit requires checkout flow",
                    "checkout_url": checkout_url,
                    "credit_cents": credit_cents,
                })
                .to_string(),
            ));
        }
        Err(plexmcp_billing::BillingError::OveragesExceedCredit {
            overage_cents,
            credit_cents,
            pay_first_url,
        }) => {
            return Err(ApiError::BadRequest(serde_json::json!({
                "code": "OVERAGES_EXCEED_CREDIT",
                "message": format!("Outstanding overages ({} cents) exceed credit ({} cents)", overage_cents, credit_cents),
                "overage_cents": overage_cents,
                "credit_cents": credit_cents,
                "pay_first_url": pay_first_url,
            }).to_string()));
        }
        Err(plexmcp_billing::BillingError::NoCustomer) => {
            return Err(ApiError::BadRequest(
                "No payment method on file. Please add a payment method first.".to_string(),
            ));
        }
        Err(plexmcp_billing::BillingError::InvalidTier(msg)) => {
            return Err(ApiError::BadRequest(format!("Invalid tier: {}", msg)));
        }
        Err(e) => {
            // DEBUG: Log all unhandled billing errors for diagnosis
            tracing::error!(
                org_id = %org_id,
                error = %e,
                error_debug = ?e,
                "Reactivation failed with unhandled error type"
            );
            return Err(ApiError::Database(format!(
                "Failed to reactivate subscription: {}",
                e
            )));
        }
    };

    // SOC 2 CC5.2: Audit log subscription reactivation
    let audit_details = serde_json::json!({
        "org_id": org_id.to_string(),
        "tier": result.tier,
        "billing_interval": result.billing_interval,
        "credit_applied_cents": result.credit_applied_cents,
        "overages_deducted_cents": result.overages_deducted_cents,
        "trial_days": result.extra_trial_days,
    });
    let _ = sqlx::query(
        r#"INSERT INTO admin_audit_log (
            admin_user_id, action, target_type, target_id, details,
            event_type, severity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
    )
    .bind(user_id)
    .bind("subscription_reactivated")
    .bind(target_type::ORGANIZATION)
    .bind(org_id)
    .bind(&audit_details)
    .bind(event_type::ADMIN_ACTION)
    .bind(severity::INFO)
    .execute(&state.pool)
    .await;

    tracing::info!(
        org_id = %org_id,
        tier = %result.tier,
        credit_applied_cents = result.credit_applied_cents,
        trial_days = result.extra_trial_days,
        "Subscription reactivated successfully"
    );

    Ok(Json(ReactivationResponse {
        status: "active".to_string(),
        tier: result.tier,
        billing_interval: result.billing_interval,
        credit_applied_cents: result.credit_applied_cents,
        extra_trial_days: result.extra_trial_days,
        overages_deducted_cents: result.overages_deducted_cents,
        current_period_end: result
            .current_period_end
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        trial_end: result.trial_end.map(|t| {
            t.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        }),
        message: result.message,
    }))
}

/// Handle Stripe webhook events
pub async fn webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> Result<StatusCode, ApiError> {
    tracing::info!(body_len = body.len(), "Stripe webhook received");

    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    // Get signature header
    let signature = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            tracing::warn!("Stripe webhook missing signature header");
            ApiError::BadRequest("Missing Stripe signature".to_string())
        })?;

    // Verify and parse event
    let event = billing
        .webhooks
        .verify_event(&body, signature)
        .map_err(|e| {
            tracing::warn!(error = ?e, "Stripe webhook signature verification failed");
            ApiError::BadRequest("Invalid webhook signature".to_string())
        })?;

    tracing::info!(
        event_type = %event.type_,
        event_id = %event.id,
        "Stripe webhook event verified"
    );

    // Handle the event
    billing.webhooks.handle_event(event).await.map_err(|e| {
        tracing::error!("Webhook handling error: {}", e);
        ApiError::Database(format!("Webhook handling error: {}", e))
    })?;

    tracing::info!("Stripe webhook processed successfully");

    Ok(StatusCode::OK)
}

// ============================================================================
// Overage Endpoints
// ============================================================================

/// Individual overage charge for API response
#[derive(Debug, Serialize)]
pub struct OverageChargeResponse {
    pub id: String,
    pub period_start: String,
    pub period_end: String,
    pub actual_usage: i64,
    pub included_limit: i64,
    pub overage_amount: i64,
    pub rate_per_1k: f64,
    pub total_charge_cents: i64,
    pub status: String,
    pub created_at: String,
}

/// Response for GET /billing/overages
#[derive(Debug, Serialize)]
pub struct OveragesResponse {
    pub charges: Vec<OverageChargeResponse>,
    pub total_paid_cents: i64,
    pub total_pending_cents: i64,
}

/// Response for GET /billing/overages/current
#[derive(Debug, Serialize)]
pub struct CurrentOverageResponse {
    pub current_usage: i64,
    pub included_limit: i64,
    pub overage_calls: i64,
    pub overage_rate: f64,
    pub estimated_charge_cents: i64,
    pub period_ends_at: Option<String>,
}

/// Query params for overages endpoint
#[derive(Debug, Deserialize)]
pub struct OveragesQuery {
    pub limit: Option<i64>,
}

/// Get overage charge history for the organization
pub async fn get_overages(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<OveragesQuery>,
) -> Result<Json<OveragesResponse>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let limit = query.limit.unwrap_or(12); // Default to 12 billing periods

    // Get overage charges
    let charges = billing
        .overage
        .get_charges(org_id, limit)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to get overages: {}", e)))?;

    // Calculate totals
    let total_paid_cents: i64 = charges
        .iter()
        .filter(|c| c.status == "paid")
        .map(|c| c.total_charge_cents as i64)
        .sum();

    let total_pending_cents: i64 = charges
        .iter()
        .filter(|c| c.status == "pending" || c.status == "invoiced")
        .map(|c| c.total_charge_cents as i64)
        .sum();

    // Convert to response format
    let charge_responses: Vec<OverageChargeResponse> = charges
        .into_iter()
        .map(|c| {
            // Calculate rate per 1K calls: rate_per_unit_cents is cents per 1K batch
            // Pro: 50 cents -> $0.50, Team: 25 cents -> $0.25
            let rate_per_1k = if c.rate_per_unit_cents > 0 {
                c.rate_per_unit_cents as f64 / 100.0 // Convert from cents to dollars
            } else {
                0.0
            };

            OverageChargeResponse {
                id: c.id.to_string(),
                period_start: c
                    .billing_period_start
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
                period_end: c
                    .billing_period_end
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
                actual_usage: c.actual_usage,
                included_limit: c.base_limit,
                overage_amount: c.overage_amount,
                rate_per_1k,
                total_charge_cents: c.total_charge_cents as i64,
                status: c.status,
                created_at: c
                    .created_at
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
            }
        })
        .collect();

    Ok(Json(OveragesResponse {
        charges: charge_responses,
        total_paid_cents,
        total_pending_cents,
    }))
}

/// Overage rates by tier (matches frontend plan definitions)
fn get_overage_rate_for_tier(tier: &str) -> f64 {
    match tier {
        "pro" => 0.50,  // $0.50 per 1K calls
        "team" => 0.25, // $0.25 per 1K calls
        _ => 0.0,       // Free and enterprise don't have overage
    }
}

/// Included call limit by tier (matches types.rs source of truth)
fn get_included_limit_for_tier(tier: &str) -> i64 {
    match tier {
        "free" => 1_000,
        "starter" => 1_000, // Legacy tier - same as Free
        "pro" => 50_000,
        "team" => 250_000,        // Corrected: was 200_000, should be 250_000
        "enterprise" => i64::MAX, // Unlimited
        _ => 1_000,
    }
}

/// Get current billing period overage status
pub async fn get_current_overage(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<CurrentOverageResponse>, ApiError> {
    tracing::info!("get_current_overage: starting");

    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    tracing::info!(org_id = %org_id, "get_current_overage: got org_id");

    // Get current subscription to find tier and billing period
    let subscription = billing
        .subscriptions
        .get_subscription(org_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "get_current_overage: failed to get subscription");
            ApiError::Database(format!("Failed to get subscription: {}", e))
        })?;
    tracing::info!(
        has_subscription = subscription.is_some(),
        "get_current_overage: got subscription result"
    );

    // Get tier from database since we may not have Stripe subscription
    let db_tier: Option<(String,)> =
        sqlx::query_as("SELECT subscription_tier FROM organizations WHERE id = $1")
            .bind(org_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "get_current_overage: failed to get org tier from db");
                ApiError::Database(format!("Failed to get org tier: {}", e))
            })?;

    // Determine tier from Stripe subscription first, then database, then default to free
    let tier = subscription
        .as_ref()
        .and_then(|sub| {
            sub.items
                .data
                .first()
                .and_then(|item| item.price.as_ref())
                .and_then(|price| {
                    billing
                        .subscriptions
                        .stripe()
                        .config()
                        .tier_for_price_id(price.id.as_str())
                })
                .map(|s| s.to_string())
        })
        .or_else(|| db_tier.map(|(t,)| t))
        .unwrap_or_else(|| "free".to_string());
    tracing::info!(tier = %tier, "get_current_overage: determined tier");

    let overage_rate = get_overage_rate_for_tier(&tier);
    let included_limit = get_included_limit_for_tier(&tier);
    tracing::info!(
        overage_rate = overage_rate,
        included_limit = included_limit,
        "get_current_overage: got rates"
    );

    // Get period info from Stripe subscription first, then from database
    let (period_start, period_end_opt): (OffsetDateTime, Option<OffsetDateTime>) = if let Some(
        sub,
    ) =
        subscription.as_ref()
    {
        let start =
            OffsetDateTime::from_unix_timestamp(sub.current_period_start).unwrap_or_else(|_| {
                let now = OffsetDateTime::now_utc();
                now.replace_day(1).unwrap_or(now)
            });
        let end = OffsetDateTime::from_unix_timestamp(sub.current_period_end).ok();
        (start, end)
    } else {
        // Try to get from database subscription
        // Note: subscriptions.customer_id stores org_id as text
        let db_sub: Option<(Option<OffsetDateTime>, Option<OffsetDateTime>)> = sqlx::query_as(
            "SELECT current_period_start, current_period_end FROM subscriptions WHERE customer_id = $1"
        )
        .bind(org_id.to_string())
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();

        if let Some((Some(start), end)) = db_sub {
            (start, end)
        } else {
            // Default to start of current month
            let now = OffsetDateTime::now_utc();
            let start = now
                .replace_day(1)
                .unwrap_or(now)
                .replace_hour(0)
                .unwrap_or(now)
                .replace_minute(0)
                .unwrap_or(now)
                .replace_second(0)
                .unwrap_or(now);
            (start, None)
        }
    };
    tracing::info!(period_start = %period_start, "get_current_overage: got period start");

    let period_ends_at = period_end_opt.map(|t| {
        t.format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default()
    });

    // Get current usage for the billing period
    let current_usage = billing
        .metered
        .get_period_usage(org_id, period_start)
        .await
        .unwrap_or(0);
    tracing::info!(
        current_usage = current_usage,
        "get_current_overage: got usage"
    );

    // Calculate total overage
    let total_overage_calls = (current_usage - included_limit).max(0);

    // Calculate total charge in cents (before subtracting paid amounts)
    // Rate is per 1K calls, so: (overage_calls / 1000) * rate * 100 (to cents)
    let total_charge_cents = if total_overage_calls > 0 && overage_rate > 0.0 {
        let units = (total_overage_calls + 999) / 1000; // Ceiling division
        (units as f64 * overage_rate * 100.0) as i64
    } else {
        0
    };

    // Subtract already-paid overages for this billing period
    let (paid_cents, paid_calls): (i64, i64) = sqlx::query_as(
        r#"
        SELECT COALESCE(SUM(total_charge_cents), 0)::BIGINT,
               COALESCE(SUM(overage_amount), 0)::BIGINT
        FROM overage_charges
        WHERE org_id = $1
          AND billing_period_start = $2
          AND resource_type = 'requests'
          AND status = 'paid'
        "#,
    )
    .bind(org_id)
    .bind(period_start)
    .fetch_one(&state.pool)
    .await
    .unwrap_or((0, 0));

    // Net outstanding overage (what user still owes)
    let overage_calls = (total_overage_calls - paid_calls).max(0);
    let estimated_charge_cents = (total_charge_cents - paid_cents).max(0);

    tracing::info!(
        total_overage_calls = total_overage_calls,
        paid_calls = paid_calls,
        overage_calls = overage_calls,
        total_charge_cents = total_charge_cents,
        paid_cents = paid_cents,
        estimated_charge_cents = estimated_charge_cents,
        "get_current_overage: calculated outstanding overage"
    );

    // Create/update overage_charges record in real-time if there's an overage
    if overage_calls > 0 && overage_rate > 0.0 {
        if let Some(period_end) = period_end_opt {
            // Fire and forget - don't fail the request if this errors
            let _ = billing
                .overage
                .create_or_update_current_overage(org_id, &tier, period_start, period_end)
                .await;
        }
    }

    Ok(Json(CurrentOverageResponse {
        current_usage,
        included_limit,
        overage_calls,
        overage_rate,
        estimated_charge_cents,
        period_ends_at,
    }))
}

/// Helper: Get or create Stripe customer for org
async fn get_or_create_customer(
    state: &AppState,
    billing: &plexmcp_billing::BillingService,
    org_id: Uuid,
    email: &str,
) -> Result<String, ApiError> {
    // Check if customer already exists
    if let Some(customer_id) = get_customer_id(state, org_id).await? {
        return Ok(customer_id);
    }

    // Get org name
    let org: Option<(String,)> = sqlx::query_as("SELECT name FROM organizations WHERE id = $1")
        .bind(org_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::Database(format!("Database error: {}", e)))?;

    let org_name = org
        .map(|(name,)| name)
        .unwrap_or_else(|| "Unknown Organization".to_string());

    // Create customer
    let customer = billing
        .customer
        .get_or_create_customer(org_id, email, &org_name)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to create customer: {}", e)))?;

    Ok(customer.id.to_string())
}

/// Helper: Get existing Stripe customer ID
async fn get_customer_id(state: &AppState, org_id: uuid::Uuid) -> Result<Option<String>, ApiError> {
    let result: Option<(Option<String>,)> =
        sqlx::query_as("SELECT stripe_customer_id FROM organizations WHERE id = $1")
            .bind(org_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::Database(format!("Database error: {}", e)))?;

    Ok(result.and_then(|(id,)| id))
}

// ============================================================================
// Spend Cap Endpoints
// ============================================================================

/// Spend cap status response
#[derive(Debug, Serialize)]
pub struct SpendCapStatusResponse {
    pub has_cap: bool,
    pub cap_amount_cents: Option<i32>,
    pub current_spend_cents: i32,
    pub percentage_used: f64,
    pub hard_pause_enabled: bool,
    pub is_paused: bool,
    pub paused_at: Option<String>,
    pub has_override: bool,
    pub override_until: Option<String>,
}

/// Request to set spend cap
#[derive(Debug, Deserialize)]
pub struct SetSpendCapRequest {
    pub cap_amount_cents: i32,
    pub hard_pause_enabled: bool,
}

/// Get spend cap status for the organization
pub async fn get_spend_cap(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<SpendCapStatusResponse>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    let status = billing
        .spend_cap
        .get_status(org_id)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to get spend cap: {}", e)))?;

    Ok(Json(SpendCapStatusResponse {
        has_cap: status.has_cap,
        cap_amount_cents: status.cap_amount_cents,
        current_spend_cents: status.current_spend_cents,
        percentage_used: status.percentage_used,
        hard_pause_enabled: status.hard_pause_enabled,
        is_paused: status.is_paused,
        paused_at: status.paused_at.map(|t| {
            t.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        }),
        has_override: status.has_override,
        override_until: status.override_until.map(|t| {
            t.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        }),
    }))
}

/// Set or update spend cap for the organization
pub async fn set_spend_cap(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<SetSpendCapRequest>,
) -> Result<Json<SpendCapStatusResponse>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Validate cap amount (minimum $10, maximum $100,000)
    // SOC 2 CC6.1: Input validation prevents unreasonable values
    const MAX_SPEND_CAP_CENTS: i32 = 100_000_00; // $100,000
    if req.cap_amount_cents < 1000 {
        return Err(ApiError::BadRequest(
            "Spend cap must be at least $10.00".to_string(),
        ));
    }
    if req.cap_amount_cents > MAX_SPEND_CAP_CENTS {
        return Err(ApiError::BadRequest(
            "Spend cap cannot exceed $100,000.00".to_string(),
        ));
    }

    let cap = billing
        .spend_cap
        .set_spend_cap(
            org_id,
            plexmcp_billing::SpendCapRequest {
                cap_amount_cents: req.cap_amount_cents,
                hard_pause_enabled: req.hard_pause_enabled,
            },
        )
        .await
        .map_err(|e| ApiError::Database(format!("Failed to set spend cap: {}", e)))?;

    let has_override = cap
        .override_until
        .map(|t| t > OffsetDateTime::now_utc())
        .unwrap_or(false);

    Ok(Json(SpendCapStatusResponse {
        has_cap: true,
        cap_amount_cents: Some(cap.cap_amount_cents),
        current_spend_cents: cap.current_period_spend_cents,
        percentage_used: if cap.cap_amount_cents > 0 {
            (cap.current_period_spend_cents as f64 / cap.cap_amount_cents as f64) * 100.0
        } else {
            0.0
        },
        hard_pause_enabled: cap.hard_pause_enabled,
        is_paused: cap.is_paused && !has_override,
        paused_at: cap.paused_at.map(|t| {
            t.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        }),
        has_override,
        override_until: cap.override_until.map(|t| {
            t.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        }),
    }))
}

/// Remove spend cap for the organization
pub async fn remove_spend_cap(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<StatusCode, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    billing
        .spend_cap
        .remove_spend_cap(org_id)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to remove spend cap: {}", e)))?;

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Pay Now Endpoints
// ============================================================================

/// Accumulated overage response
#[derive(Debug, Serialize)]
pub struct AccumulatedOverageResponse {
    pub total_cents: i32,
    pub total_requests: i64,
    pub charge_count: i32,
}

/// Pay now result response - uses Checkout Sessions for guaranteed user interaction
#[derive(Debug, Serialize)]
#[serde(tag = "status")]
pub enum PayNowResponse {
    /// No pending charges to pay
    NoPendingCharges,
    /// Payment required - user must complete checkout
    PaymentRequired {
        checkout_session_id: String,
        checkout_url: String,
        amount_cents: i32,
        charge_count: i32,
    },
    /// Payment already completed
    AlreadyPaid {
        amount_cents: i32,
        charge_count: i32,
    },
}

/// Get accumulated overage for pay-now display
pub async fn get_accumulated_overage(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<AccumulatedOverageResponse>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Sync early payment status from Stripe as fallback for webhook failures
    // This ensures we show accurate payment status even if webhooks didn't fire
    if let Err(e) = billing.overage.sync_early_payment_status(org_id).await {
        tracing::warn!(
            org_id = %org_id,
            error = %e,
            "Failed to sync early payment status (continuing anyway)"
        );
    }

    let overage = billing
        .overage
        .get_accumulated_overage(org_id)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to get accumulated overage: {}", e)))?;

    Ok(Json(AccumulatedOverageResponse {
        total_cents: overage.total_cents,
        total_requests: overage.total_requests,
        charge_count: overage.charge_count,
    }))
}

/// Pay all accumulated overages now
pub async fn pay_overages_now(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<PayNowResponse>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let email = auth_user.email.as_deref().unwrap_or("");

    // Get customer ID
    let customer_id = get_or_create_customer(&state, billing, org_id, email).await?;

    let result = billing
        .overage
        .pay_overages_now(org_id, &customer_id)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to process pay now: {}", e)))?;

    match result {
        plexmcp_billing::PayNowResult::NoPendingCharges => {
            Ok(Json(PayNowResponse::NoPendingCharges))
        }
        plexmcp_billing::PayNowResult::PaymentRequired {
            checkout_session_id,
            checkout_url,
            amount_cents,
            charge_count,
        } => Ok(Json(PayNowResponse::PaymentRequired {
            checkout_session_id,
            checkout_url,
            amount_cents,
            charge_count,
        })),
        plexmcp_billing::PayNowResult::AlreadyPaid {
            amount_cents,
            charge_count,
        } => Ok(Json(PayNowResponse::AlreadyPaid {
            amount_cents,
            charge_count,
        })),
    }
}

// ============================================================================
// Instant Charge Endpoints
// ============================================================================

/// Instant charge response
#[derive(Debug, Serialize)]
pub struct InstantChargeResponse {
    pub id: String,
    pub amount_cents: i32,
    pub overage_at_charge: i64,
    pub status: String,
    pub created_at: String,
    pub paid_at: Option<String>,
}

/// Get instant charge history for the organization
pub async fn get_instant_charges(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<OveragesQuery>,
) -> Result<Json<Vec<InstantChargeResponse>>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let limit = query.limit.unwrap_or(20);

    let charges = billing
        .instant_charge
        .get_charges(org_id, limit)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to get instant charges: {}", e)))?;

    let responses: Vec<InstantChargeResponse> = charges
        .into_iter()
        .map(|c| InstantChargeResponse {
            id: c.id.to_string(),
            amount_cents: c.amount_cents,
            overage_at_charge: c.overage_at_charge,
            status: c.status,
            created_at: c
                .created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
            paid_at: c.paid_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
        })
        .collect();

    Ok(Json(responses))
}

// ============================================================================
// Subscription Downgrade Scheduling Endpoints
// ============================================================================

/// Request to schedule a downgrade
#[derive(Debug, Deserialize)]
pub struct ScheduleDowngradeRequest {
    pub tier: String,
}

/// Summary of a member who will be affected by downgrade
#[derive(Debug, Serialize)]
pub struct AffectedMemberSummary {
    pub email: String,
    pub role: String,
}

/// Information about members affected by downgrade
#[derive(Debug, Serialize)]
pub struct AffectedMembersInfo {
    pub current_count: i64,
    pub new_limit: u32,
    pub excess_count: u32,
    pub members_to_suspend: Vec<AffectedMemberSummary>,
}

/// Response for scheduled downgrade
#[derive(Debug, Serialize)]
pub struct ScheduleDowngradeResponse {
    pub current_tier: String,
    pub new_tier: String,
    pub effective_date: String,
    pub message: String,
    /// Members who will be suspended when downgrade takes effect
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_members: Option<AffectedMembersInfo>,
}

/// Schedule a subscription downgrade for the end of the billing period
/// User keeps current tier until period ends, then automatically switches to new tier
pub async fn schedule_downgrade(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<ScheduleDowngradeRequest>,
) -> Result<Json<ScheduleDowngradeResponse>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let user_id = auth_user.user_id;

    let result = billing
        .subscriptions
        .schedule_downgrade(org_id, &req.tier)
        .await
        .map_err(|e| {
            if e.to_string().contains("use upgrade flow") {
                return ApiError::BadRequest(e.to_string());
            }
            ApiError::Database(format!("Failed to schedule downgrade: {}", e))
        })?;

    // SOC 2 CC5.2: Audit log scheduled downgrade
    let audit_details = serde_json::json!({
        "org_id": org_id.to_string(),
        "current_tier": result.current_tier,
        "new_tier": result.new_tier,
        "effective_date": result.effective_date.format(&time::format_description::well_known::Rfc3339).unwrap_or_default(),
    });
    let _ = sqlx::query(
        r#"INSERT INTO admin_audit_log (
            admin_user_id, action, target_type, target_id, details,
            event_type, severity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
    )
    .bind(user_id)
    .bind(admin_action::SUBSCRIPTION_CHANGED)
    .bind(target_type::ORGANIZATION)
    .bind(org_id)
    .bind(&audit_details)
    .bind(event_type::ADMIN_ACTION)
    .bind(severity::INFO)
    .execute(&state.pool)
    .await;

    // Check if any members will be affected by the downgrade
    let affected_members = billing
        .member_suspension
        .get_affected_members_info(org_id, &req.tier)
        .await
        .ok()
        .flatten()
        .map(|info| AffectedMembersInfo {
            current_count: info.current_count,
            new_limit: info.new_limit,
            excess_count: info.excess_count,
            members_to_suspend: info
                .members_to_suspend
                .into_iter()
                .map(|m| AffectedMemberSummary {
                    email: m.email,
                    role: m.role,
                })
                .collect(),
        });

    let affected_msg = if let Some(ref affected) = affected_members {
        format!(
            " {} team member(s) will be set to read-only access due to the {} tier limit of {}.",
            affected.excess_count, result.new_tier, affected.new_limit
        )
    } else {
        String::new()
    };

    tracing::info!(
        org_id = %org_id,
        from_tier = %result.current_tier,
        to_tier = %result.new_tier,
        effective_date = %result.effective_date,
        affected_members = affected_members.as_ref().map(|a| a.excess_count).unwrap_or(0),
        "Scheduled subscription downgrade"
    );

    Ok(Json(ScheduleDowngradeResponse {
        current_tier: result.current_tier.clone(),
        new_tier: result.new_tier.clone(),
        effective_date: result.effective_date
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        message: format!(
            "Your subscription will change from {} to {} on {}. You'll retain all {} features until then.{}",
            result.current_tier,
            result.new_tier,
            time::format_description::parse("[month repr:long] [day], [year]").ok()
                .and_then(|desc| result.effective_date.format(&desc).ok())
                .unwrap_or_else(|| "Unknown date".to_string()),
            result.current_tier,
            affected_msg
        ),
        affected_members,
    }))
}

/// Cancel a scheduled downgrade
pub async fn cancel_scheduled_downgrade(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<StatusCode, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    billing
        .subscriptions
        .cancel_scheduled_downgrade(org_id)
        .await
        .map_err(|e| {
            if e.to_string().contains("No scheduled downgrade") {
                return ApiError::BadRequest("No scheduled downgrade to cancel".to_string());
            }
            ApiError::Database(format!("Failed to cancel scheduled downgrade: {}", e))
        })?;

    tracing::info!(
        org_id = %org_id,
        "Cancelled scheduled downgrade"
    );

    Ok(StatusCode::NO_CONTENT)
}

/// Get scheduled downgrade info (if any)
pub async fn get_scheduled_downgrade(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Option<ScheduleDowngradeResponse>>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    let result = billing
        .subscriptions
        .get_scheduled_downgrade(org_id)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to get scheduled downgrade: {}", e)))?;

    // For get_scheduled_downgrade, we don't compute affected_members since it's just a status check
    // The schedule_downgrade endpoint returns affected_members when scheduling
    Ok(Json(result.map(|d| {
        ScheduleDowngradeResponse {
            current_tier: d.current_tier.clone(),
            new_tier: d.new_tier.clone(),
            effective_date: d
                .effective_date
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
            message: format!(
                "Your subscription will change from {} to {} on {}.",
                d.current_tier,
                d.new_tier,
                time::format_description::parse("[month repr:long] [day], [year]")
                    .ok()
                    .and_then(|desc| d.effective_date.format(&desc).ok())
                    .unwrap_or_else(|| "Unknown date".to_string())
            ),
            affected_members: None,
        }
    })))
}

// ============================================================================
// Invoice Endpoints (Database-backed with line items and disputes)
// ============================================================================

/// Invoice list item for API response
#[derive(Debug, Serialize)]
pub struct InvoiceListItem {
    pub id: String,
    pub invoice_number: String,
    pub stripe_invoice_id: Option<String>,
    pub amount_cents: i32,
    pub amount_due_cents: i32,
    pub amount_paid_cents: i32,
    pub currency: String,
    pub status: String,
    pub description: Option<String>,
    pub due_date: Option<String>,
    pub paid_at: Option<String>,
    pub grace_period_ends_at: Option<String>,
    pub invoice_pdf_url: Option<String>,
    pub hosted_invoice_url: Option<String>,
    pub created_at: String,
}

/// Invoice with line items for detail view
#[derive(Debug, Serialize)]
pub struct InvoiceDetailResponse {
    #[serde(flatten)]
    pub invoice: InvoiceListItem,
    pub line_items: Vec<InvoiceLineItemResponse>,
    pub payment_attempts: Vec<PaymentAttemptResponse>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub billing_reason: Option<String>,
}

/// Invoice line item for API response
#[derive(Debug, Serialize)]
pub struct InvoiceLineItemResponse {
    pub id: String,
    pub description: String,
    pub quantity: i32,
    pub unit_amount_cents: i32,
    pub amount_cents: i32,
    pub currency: String,
    pub proration: bool,
    pub product_name: Option<String>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
}

/// Payment attempt for API response
#[derive(Debug, Serialize)]
pub struct PaymentAttemptResponse {
    pub id: String,
    pub amount_cents: i32,
    pub currency: String,
    pub status: String,
    pub failure_code: Option<String>,
    pub failure_message: Option<String>,
    pub created_at: String,
}

/// Invoice list response
#[derive(Debug, Serialize)]
pub struct InvoiceListResponse {
    pub invoices: Vec<InvoiceListItem>,
    pub total_count: i64,
    pub outstanding_amount_cents: i64,
    pub overdue_amount_cents: i64,
}

/// Query params for invoice list
#[derive(Debug, Deserialize)]
pub struct InvoiceListQuery {
    pub status: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Grace period status response
#[derive(Debug, Serialize)]
pub struct GracePeriodStatusResponse {
    pub is_in_grace_period: bool,
    pub is_blocked: bool,
    pub days_remaining: Option<i64>,
    pub grace_period_ends_at: Option<String>,
    pub blocked_at: Option<String>,
    pub overdue_invoice_count: i32,
    pub overdue_amount_cents: i64,
}

/// Invoice dispute request
#[derive(Debug, Deserialize)]
pub struct CreateDisputeRequest {
    pub reason: String,
    pub description: String,
}

/// Invoice dispute response
#[derive(Debug, Serialize)]
pub struct InvoiceDisputeResponse {
    pub id: String,
    pub invoice_id: String,
    pub reason: String,
    pub description: String,
    pub status: String,
    pub created_at: String,
}

/// Pay invoice response
#[derive(Debug, Serialize)]
#[serde(tag = "result")]
pub enum PayInvoiceResponse {
    #[serde(rename = "already_paid")]
    AlreadyPaid,
    #[serde(rename = "payment_initiated")]
    PaymentInitiated { hosted_invoice_url: String },
    #[serde(rename = "payment_succeeded")]
    PaymentSucceeded {
        invoice_id: String,
        amount_cents: i32,
    },
}

/// List invoices for an organization
///
/// SOC 2 CC6.1: RBAC - Only owners and admins can access invoice list
pub async fn list_invoices(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Query(query): Query<InvoiceListQuery>,
) -> Result<Json<InvoiceListResponse>, ApiError> {
    tracing::info!(
        user_id = ?auth_user.user_id,
        org_id = ?auth_user.org_id,
        role = %auth_user.role,
        auth_method = ?auth_user.auth_method,
        "list_invoices: starting"
    );

    let org_id = auth_user.org_id.ok_or_else(|| {
        tracing::error!("list_invoices: NoOrganization error - auth_user.org_id is None");
        ApiError::NoOrganization
    })?;

    // SOC 2 CC6.1: RBAC check - only owners and admins can access invoice list
    let role = auth_user.role.as_str();
    if !["owner", "admin"].contains(&role) {
        tracing::warn!(
            user_id = ?auth_user.user_id,
            org_id = %org_id,
            role = %role,
            "Unauthorized invoice list access attempt - insufficient role"
        );
        return Err(ApiError::Forbidden);
    }

    tracing::info!(org_id = %org_id, "list_invoices: got org_id, preparing query");

    let limit = query.limit.unwrap_or(50).min(100);
    let offset = query.offset.unwrap_or(0);

    tracing::info!(limit = %limit, offset = %offset, status = ?query.status, "list_invoices: query params");

    // Build query with optional status filter
    #[allow(clippy::type_complexity)]
    let invoices: Vec<(
        Uuid, Option<String>, Option<String>, i32, Option<i32>, Option<i32>,
        String, String, Option<String>, Option<OffsetDateTime>, Option<OffsetDateTime>,
        Option<OffsetDateTime>, Option<String>, Option<String>, OffsetDateTime
    )> = if let Some(status) = &query.status {
        tracing::info!("list_invoices: executing query with status filter");
        sqlx::query_as(
            r#"
            SELECT id, invoice_number, stripe_invoice_id, amount_cents, amount_due_cents, amount_paid_cents,
                   currency, status, description, due_date, paid_at,
                   grace_period_ends_at, invoice_pdf_url, hosted_invoice_url, created_at
            FROM invoices
            WHERE org_id = $1 AND status = $2
            ORDER BY created_at DESC
            LIMIT $3 OFFSET $4
            "#
        )
        .bind(org_id)
        .bind(status)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await
    } else {
        tracing::info!("list_invoices: executing query without status filter");
        sqlx::query_as(
            r#"
            SELECT id, invoice_number, stripe_invoice_id, amount_cents, amount_due_cents, amount_paid_cents,
                   currency, status, description, due_date, paid_at,
                   grace_period_ends_at, invoice_pdf_url, hosted_invoice_url, created_at
            FROM invoices
            WHERE org_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#
        )
        .bind(org_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await
    }.map_err(|e| {
        tracing::error!(error = %e, "list_invoices: database query failed");
        ApiError::Database(format!("Failed to fetch invoices: {}", e))
    })?;

    tracing::info!(count = %invoices.len(), "list_invoices: got invoices from database");

    // Get total count
    let total_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM invoices WHERE org_id = $1")
        .bind(org_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to count invoices: {}", e)))?;

    // Calculate outstanding and overdue amounts
    let amounts: (Option<i64>, Option<i64>) = sqlx::query_as(
        r#"
        SELECT
            COALESCE(SUM(CASE WHEN status IN ('open', 'uncollectible') THEN amount_due_cents ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN status IN ('open', 'uncollectible') AND due_date < NOW() THEN amount_due_cents ELSE 0 END), 0)
        FROM invoices
        WHERE org_id = $1
        "#
    )
    .bind(org_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Database(format!("Failed to calculate amounts: {}", e)))?;

    let invoice_items: Vec<InvoiceListItem> = invoices
        .into_iter()
        .map(|row| InvoiceListItem {
            id: row.0.to_string(),
            invoice_number: row.1.unwrap_or_else(|| {
                format!(
                    "INV-{}",
                    row.0.to_string().split('-').next().unwrap_or("UNKNOWN")
                )
            }),
            stripe_invoice_id: row.2,
            amount_cents: row.3,
            amount_due_cents: row.4.unwrap_or(0),
            amount_paid_cents: row.5.unwrap_or(0),
            currency: row.6,
            status: row.7,
            description: row.8,
            due_date: row.9.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            paid_at: row.10.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            grace_period_ends_at: row.11.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            invoice_pdf_url: row.12,
            hosted_invoice_url: row.13,
            created_at: row
                .14
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        })
        .collect();

    Ok(Json(InvoiceListResponse {
        invoices: invoice_items,
        total_count: total_count.0,
        outstanding_amount_cents: amounts.0.unwrap_or(0),
        overdue_amount_cents: amounts.1.unwrap_or(0),
    }))
}

/// Row struct for invoice detail query (sqlx requires struct for >16 columns)
#[derive(sqlx::FromRow)]
struct InvoiceDetailRow {
    id: Uuid,
    invoice_number: Option<String>,
    stripe_invoice_id: Option<String>,
    amount_cents: i32,
    amount_due_cents: Option<i32>,
    amount_paid_cents: Option<i32>,
    currency: String,
    status: String,
    description: Option<String>,
    due_date: Option<OffsetDateTime>,
    paid_at: Option<OffsetDateTime>,
    grace_period_ends_at: Option<OffsetDateTime>,
    invoice_pdf_url: Option<String>,
    hosted_invoice_url: Option<String>,
    created_at: OffsetDateTime,
    period_start: Option<OffsetDateTime>,
    period_end: Option<OffsetDateTime>,
    billing_reason: Option<String>,
}

/// Get invoice detail with line items
///
/// SOC 2 CC6.1: RBAC - Only owners and admins can access invoice details
pub async fn get_invoice_detail(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    axum::extract::Path(invoice_id): axum::extract::Path<Uuid>,
) -> Result<Json<InvoiceDetailResponse>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // SOC 2 CC6.1: RBAC check - only owners and admins can access invoice details
    let role = auth_user.role.as_str();
    if !["owner", "admin"].contains(&role) {
        tracing::warn!(
            user_id = ?auth_user.user_id,
            org_id = %org_id,
            role = %role,
            invoice_id = %invoice_id,
            "Unauthorized invoice access attempt - insufficient role"
        );
        return Err(ApiError::Forbidden);
    }

    // Fetch invoice with org check
    let invoice: Option<InvoiceDetailRow> = sqlx::query_as(
        r#"
        SELECT id, invoice_number, stripe_invoice_id, amount_cents, amount_due_cents, amount_paid_cents,
               currency, status, description, due_date, paid_at,
               grace_period_ends_at, invoice_pdf_url, hosted_invoice_url, created_at,
               period_start, period_end, billing_reason
        FROM invoices
        WHERE id = $1 AND org_id = $2
        "#
    )
    .bind(invoice_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Database(format!("Failed to fetch invoice: {}", e)))?;

    let invoice = invoice.ok_or(ApiError::NotFound)?;

    // Fetch line items
    #[allow(clippy::type_complexity)]
    let line_items: Vec<(
        Uuid,
        String,
        i32,
        i32,
        i32,
        String,
        bool,
        Option<String>,
        Option<OffsetDateTime>,
        Option<OffsetDateTime>,
    )> = sqlx::query_as(
        r#"
        SELECT id, description, quantity, unit_amount_cents, amount_cents,
               currency, proration, product_name, period_start, period_end
        FROM invoice_line_items
        WHERE invoice_id = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(invoice_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Database(format!("Failed to fetch line items: {}", e)))?;

    // Fetch payment attempts
    #[allow(clippy::type_complexity)]
    let payment_attempts: Vec<(
        Uuid,
        i32,
        String,
        String,
        Option<String>,
        Option<String>,
        OffsetDateTime,
    )> = sqlx::query_as(
        r#"
        SELECT id, amount_cents, currency, status, failure_code, failure_message, created_at
        FROM payment_attempts
        WHERE invoice_id = $1
        ORDER BY created_at DESC
        "#,
    )
    .bind(invoice_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let line_item_responses: Vec<InvoiceLineItemResponse> = line_items
        .into_iter()
        .map(|row| InvoiceLineItemResponse {
            id: row.0.to_string(),
            description: row.1,
            quantity: row.2,
            unit_amount_cents: row.3,
            amount_cents: row.4,
            currency: row.5,
            proration: row.6,
            product_name: row.7,
            period_start: row.8.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            period_end: row.9.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
        })
        .collect();

    let payment_attempt_responses: Vec<PaymentAttemptResponse> = payment_attempts
        .into_iter()
        .map(|row| PaymentAttemptResponse {
            id: row.0.to_string(),
            amount_cents: row.1,
            currency: row.2,
            status: row.3,
            failure_code: row.4,
            failure_message: row.5,
            created_at: row
                .6
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        })
        .collect();

    Ok(Json(InvoiceDetailResponse {
        invoice: InvoiceListItem {
            id: invoice.id.to_string(),
            invoice_number: invoice.invoice_number.unwrap_or_else(|| {
                format!(
                    "INV-{}",
                    invoice
                        .id
                        .to_string()
                        .split('-')
                        .next()
                        .unwrap_or("UNKNOWN")
                )
            }),
            stripe_invoice_id: invoice.stripe_invoice_id.clone(),
            amount_cents: invoice.amount_cents,
            amount_due_cents: invoice.amount_due_cents.unwrap_or(0),
            amount_paid_cents: invoice.amount_paid_cents.unwrap_or(0),
            currency: invoice.currency.clone(),
            status: invoice.status.clone(),
            description: invoice.description.clone(),
            due_date: invoice.due_date.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            paid_at: invoice.paid_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            grace_period_ends_at: invoice.grace_period_ends_at.map(|t| {
                t.format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default()
            }),
            invoice_pdf_url: invoice.invoice_pdf_url.clone(),
            hosted_invoice_url: invoice.hosted_invoice_url.clone(),
            created_at: invoice
                .created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        },
        line_items: line_item_responses,
        payment_attempts: payment_attempt_responses,
        period_start: invoice.period_start.map(|t| {
            t.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        }),
        period_end: invoice.period_end.map(|t| {
            t.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        }),
        billing_reason: invoice.billing_reason,
    }))
}

/// Pay an invoice via Stripe
///
/// SOC 2 CC6.1: RBAC - Only owners and admins can pay invoices
pub async fn pay_invoice(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    axum::extract::Path(invoice_id): axum::extract::Path<Uuid>,
) -> Result<Json<PayInvoiceResponse>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // SOC 2 CC6.1: RBAC check - only owners and admins can pay invoices
    let role = auth_user.role.as_str();
    if !["owner", "admin"].contains(&role) {
        tracing::warn!(
            user_id = ?auth_user.user_id,
            org_id = %org_id,
            role = %role,
            invoice_id = %invoice_id,
            "Unauthorized invoice payment attempt - insufficient role"
        );
        return Err(ApiError::Forbidden);
    }

    // Fetch invoice and verify ownership
    let invoice: Option<(String, Option<String>, i32)> = sqlx::query_as(
        "SELECT status, stripe_invoice_id, amount_due_cents FROM invoices WHERE id = $1 AND org_id = $2"
    )
    .bind(invoice_id)
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Database(format!("Failed to fetch invoice: {}", e)))?;

    let (status, stripe_invoice_id, amount_due_cents) = invoice.ok_or(ApiError::NotFound)?;

    // Check if already paid
    if status == "paid" {
        return Ok(Json(PayInvoiceResponse::AlreadyPaid));
    }

    // Get the Stripe invoice ID
    let stripe_inv_id = stripe_invoice_id
        .ok_or_else(|| ApiError::BadRequest("Invoice has no Stripe reference".to_string()))?;

    // Try to pay the invoice via Stripe
    let stripe = billing.subscriptions.stripe();
    let invoice_id_parsed: InvoiceId = stripe_inv_id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid Stripe invoice ID".to_string()))?;

    // Retrieve the invoice to get the hosted URL
    let stripe_invoice = Invoice::retrieve(stripe.inner(), &invoice_id_parsed, &[])
        .await
        .map_err(|e| ApiError::Database(format!("Failed to retrieve Stripe invoice: {}", e)))?;

    // If the invoice has a hosted URL, redirect user there to complete payment
    if let Some(hosted_url) = stripe_invoice.hosted_invoice_url {
        return Ok(Json(PayInvoiceResponse::PaymentInitiated {
            hosted_invoice_url: hosted_url,
        }));
    }

    // Try to pay the invoice directly if it's finalised and has a payment method
    match Invoice::pay(stripe.inner(), &invoice_id_parsed).await {
        Ok(paid_invoice) => {
            // Update local database
            sqlx::query("UPDATE invoices SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = $1")
                .bind(invoice_id)
                .execute(&state.pool)
                .await
                .map_err(|e| ApiError::Database(format!("Failed to update invoice status: {}", e)))?;

            Ok(Json(PayInvoiceResponse::PaymentSucceeded {
                invoice_id: invoice_id.to_string(),
                amount_cents: paid_invoice.amount_paid.unwrap_or(amount_due_cents as i64) as i32,
            }))
        }
        Err(e) => {
            // Payment failed, return error with details
            Err(ApiError::BadRequest(format!("Payment failed: {}", e)))
        }
    }
}

/// Create an invoice dispute
///
/// SOC 2 CC6.1: RBAC - Only owners and admins can create disputes
pub async fn create_invoice_dispute(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    axum::extract::Path(invoice_id): axum::extract::Path<Uuid>,
    Json(req): Json<CreateDisputeRequest>,
) -> Result<Json<InvoiceDisputeResponse>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;
    let user_id = auth_user.user_id;

    // SOC 2 CC6.1: RBAC check - only owners and admins can create disputes
    let role = auth_user.role.as_str();
    if !["owner", "admin"].contains(&role) {
        tracing::warn!(
            user_id = ?user_id,
            org_id = %org_id,
            role = %role,
            invoice_id = %invoice_id,
            "Unauthorized invoice dispute creation attempt - insufficient role"
        );
        return Err(ApiError::Forbidden);
    }

    // Validate reason
    let valid_reasons = [
        "billing_error",
        "duplicate_charge",
        "service_issue",
        "incorrect_amount",
        "other",
    ];
    if !valid_reasons.contains(&req.reason.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "Invalid reason. Must be one of: {}",
            valid_reasons.join(", ")
        )));
    }

    // Verify invoice exists and belongs to org
    let exists: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM invoices WHERE id = $1 AND org_id = $2")
            .bind(invoice_id)
            .bind(org_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to verify invoice: {}", e)))?;

    if exists.is_none() {
        return Err(ApiError::NotFound);
    }

    // Check for existing open dispute
    let existing: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM invoice_disputes WHERE invoice_id = $1 AND status = 'open'")
            .bind(invoice_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to check existing disputes: {}", e)))?;

    if existing.is_some() {
        return Err(ApiError::BadRequest(
            "An open dispute already exists for this invoice".to_string(),
        ));
    }

    // Create dispute
    let dispute_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();

    sqlx::query(
        r#"
        INSERT INTO invoice_disputes (id, invoice_id, org_id, user_id, reason, description, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $7)
        "#
    )
    .bind(dispute_id)
    .bind(invoice_id)
    .bind(org_id)
    .bind(user_id)
    .bind(&req.reason)
    .bind(&req.description)
    .bind(now)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Database(format!("Failed to create dispute: {}", e)))?;

    tracing::info!(
        dispute_id = %dispute_id,
        invoice_id = %invoice_id,
        org_id = %org_id,
        reason = %req.reason,
        "Created invoice dispute"
    );

    Ok(Json(InvoiceDisputeResponse {
        id: dispute_id.to_string(),
        invoice_id: invoice_id.to_string(),
        reason: req.reason,
        description: req.description,
        status: "open".to_string(),
        created_at: now
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
    }))
}

/// Sync invoices response
#[derive(Debug, Serialize)]
pub struct SyncInvoicesResponse {
    pub synced_count: i32,
    pub message: String,
}

/// Sync invoices from Stripe
///
/// SOC 2 CC6.1: RBAC - Only owners and admins can sync invoices
pub async fn sync_invoices(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<SyncInvoicesResponse>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // SOC 2 CC6.1: RBAC check - only owners and admins can sync invoices
    let role = auth_user.role.as_str();
    if !["owner", "admin"].contains(&role) {
        tracing::warn!(
            user_id = ?auth_user.user_id,
            org_id = %org_id,
            role = %role,
            "Unauthorized invoice sync attempt - insufficient role"
        );
        return Err(ApiError::Forbidden);
    }

    // Get customer ID for the org
    let customer_id = get_customer_id(&state, org_id).await?.ok_or_else(|| {
        ApiError::BadRequest("No Stripe customer found for this organization".to_string())
    })?;

    tracing::info!(org_id = %org_id, customer_id = %customer_id, "Syncing invoices from Stripe");

    // Fetch invoices from Stripe
    let stripe = billing.subscriptions.stripe();
    let customer_id_parsed: stripe::CustomerId = customer_id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid customer ID".to_string()))?;

    let invoices = stripe::Invoice::list(
        stripe.inner(),
        &stripe::ListInvoices {
            customer: Some(customer_id_parsed),
            limit: Some(100),
            ..Default::default()
        },
    )
    .await
    .map_err(|e| ApiError::Database(format!("Failed to fetch invoices from Stripe: {}", e)))?;

    let mut synced_count = 0;

    for inv in invoices.data {
        let stripe_invoice_id = inv.id.to_string();
        let amount_cents = inv.amount_due.unwrap_or(0) as i32;
        let amount_due_cents = inv.amount_remaining.unwrap_or(0) as i32;
        let amount_paid_cents = inv.amount_paid.unwrap_or(0) as i32;
        let currency = inv
            .currency
            .map(|c| c.to_string())
            .unwrap_or_else(|| "usd".to_string());

        // Map Stripe status to our status
        let status = match inv.status {
            Some(stripe::InvoiceStatus::Draft) => "draft",
            Some(stripe::InvoiceStatus::Open) => "open",
            Some(stripe::InvoiceStatus::Paid) => "paid",
            Some(stripe::InvoiceStatus::Void) => "void",
            Some(stripe::InvoiceStatus::Uncollectible) => "uncollectible",
            None => "unknown",
        };

        let description = inv.description.clone();
        let due_date = inv
            .due_date
            .and_then(|ts| OffsetDateTime::from_unix_timestamp(ts).ok());
        let paid_at = if status == "paid" {
            inv.status_transitions
                .as_ref()
                .and_then(|st| st.paid_at)
                .and_then(|ts| OffsetDateTime::from_unix_timestamp(ts).ok())
        } else {
            None
        };
        let invoice_pdf_url = inv.invoice_pdf.clone();
        let hosted_invoice_url = inv.hosted_invoice_url.clone();
        let period_start = inv
            .period_start
            .and_then(|ts| OffsetDateTime::from_unix_timestamp(ts).ok());
        let period_end = inv
            .period_end
            .and_then(|ts| OffsetDateTime::from_unix_timestamp(ts).ok());
        let billing_reason = inv
            .billing_reason
            .map(|r| format!("{:?}", r).to_lowercase());
        let created_at = OffsetDateTime::from_unix_timestamp(inv.created.unwrap_or(0))
            .unwrap_or_else(|_| OffsetDateTime::now_utc());

        // Upsert invoice into database
        let result = sqlx::query(
            r#"
            INSERT INTO invoices (
                org_id, stripe_invoice_id, amount_cents, amount_due_cents, amount_paid_cents,
                currency, status, description, due_date, paid_at,
                invoice_pdf_url, hosted_invoice_url, period_start, period_end, billing_reason, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (stripe_invoice_id) DO UPDATE SET
                amount_cents = EXCLUDED.amount_cents,
                amount_due_cents = EXCLUDED.amount_due_cents,
                amount_paid_cents = EXCLUDED.amount_paid_cents,
                status = EXCLUDED.status,
                due_date = EXCLUDED.due_date,
                paid_at = EXCLUDED.paid_at,
                invoice_pdf_url = EXCLUDED.invoice_pdf_url,
                hosted_invoice_url = EXCLUDED.hosted_invoice_url,
                updated_at = NOW()
            "#
        )
        .bind(org_id)
        .bind(&stripe_invoice_id)
        .bind(amount_cents)
        .bind(amount_due_cents)
        .bind(amount_paid_cents)
        .bind(&currency)
        .bind(status)
        .bind(&description)
        .bind(due_date)
        .bind(paid_at)
        .bind(&invoice_pdf_url)
        .bind(&hosted_invoice_url)
        .bind(period_start)
        .bind(period_end)
        .bind(&billing_reason)
        .bind(created_at)
        .execute(&state.pool)
        .await;

        match result {
            Ok(_) => synced_count += 1,
            Err(e) => {
                tracing::warn!(
                    stripe_invoice_id = %stripe_invoice_id,
                    error = %e,
                    "Failed to sync invoice"
                );
            }
        }

        // Also sync line items for this invoice
        if let Some(lines) = inv.lines {
            // Get the invoice DB ID first
            let invoice_db_id: Option<(Uuid,)> =
                sqlx::query_as("SELECT id FROM invoices WHERE stripe_invoice_id = $1")
                    .bind(&stripe_invoice_id)
                    .fetch_optional(&state.pool)
                    .await
                    .ok()
                    .flatten();

            if let Some((inv_id,)) = invoice_db_id {
                // Delete existing line items and re-insert (simpler than upsert without unique constraint)
                let _ = sqlx::query("DELETE FROM invoice_line_items WHERE invoice_id = $1")
                    .bind(inv_id)
                    .execute(&state.pool)
                    .await;

                for line in lines.data {
                    let line_item_id = line.id.to_string();
                    let line_description = line
                        .description
                        .clone()
                        .unwrap_or_else(|| "Invoice item".to_string());
                    let quantity = line.quantity.unwrap_or(1) as i32;
                    // Calculate unit amount from total / quantity
                    let line_amount = line.amount as i32;
                    let unit_amount = if quantity > 0 {
                        line_amount / quantity
                    } else {
                        line_amount
                    };
                    let line_currency = line.currency.to_string();
                    let proration = line.proration;
                    let product_name = line
                        .price
                        .as_ref()
                        .and_then(|p| p.product.as_ref())
                        .and_then(|prod| match prod {
                            stripe::Expandable::Object(p) => p.name.clone(),
                            _ => None,
                        });
                    let line_period_start = line
                        .period
                        .as_ref()
                        .and_then(|p| p.start)
                        .and_then(|ts| OffsetDateTime::from_unix_timestamp(ts).ok());
                    let line_period_end = line
                        .period
                        .as_ref()
                        .and_then(|p| p.end)
                        .and_then(|ts| OffsetDateTime::from_unix_timestamp(ts).ok());

                    let _ = sqlx::query(
                        r#"
                        INSERT INTO invoice_line_items (
                            invoice_id, stripe_line_item_id, description, quantity,
                            unit_amount_cents, amount_cents, currency, proration, product_name,
                            period_start, period_end
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        "#,
                    )
                    .bind(inv_id)
                    .bind(&line_item_id)
                    .bind(&line_description)
                    .bind(quantity)
                    .bind(unit_amount)
                    .bind(line_amount)
                    .bind(&line_currency)
                    .bind(proration)
                    .bind(&product_name)
                    .bind(line_period_start)
                    .bind(line_period_end)
                    .execute(&state.pool)
                    .await;
                }
            }
        }
    }

    tracing::info!(org_id = %org_id, synced_count = synced_count, "Invoice sync completed");

    Ok(Json(SyncInvoicesResponse {
        synced_count,
        message: format!("Synced {} invoices from Stripe", synced_count),
    }))
}

/// Get grace period status for the organization
pub async fn get_grace_period_status(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<GracePeriodStatusResponse>, ApiError> {
    let org_id = auth_user.org_id.ok_or(ApiError::NoOrganization)?;

    // Check if org is blocked
    let org_status: Option<(Option<OffsetDateTime>,)> =
        sqlx::query_as("SELECT billing_blocked_at FROM organizations WHERE id = $1")
            .bind(org_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::Database(format!("Failed to get org status: {}", e)))?;

    let blocked_at = org_status.and_then(|(t,)| t);
    let is_blocked = blocked_at.is_some();

    // Get overdue invoices info
    let overdue_info: (i64, Option<i64>, Option<OffsetDateTime>) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*),
            COALESCE(SUM(amount_due_cents), 0),
            MIN(grace_period_ends_at)
        FROM invoices
        WHERE org_id = $1
          AND status IN ('open', 'uncollectible')
          AND due_date < NOW()
        "#,
    )
    .bind(org_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Database(format!("Failed to get overdue info: {}", e)))?;

    let overdue_count = overdue_info.0 as i32;
    let overdue_amount = overdue_info.1.unwrap_or(0);
    let earliest_grace_period_end = overdue_info.2;

    // Calculate days remaining in grace period
    let (is_in_grace_period, days_remaining) = if let Some(grace_end) = earliest_grace_period_end {
        let now = OffsetDateTime::now_utc();
        if now < grace_end {
            let duration = grace_end - now;
            (true, Some(duration.whole_days()))
        } else {
            (false, Some(0))
        }
    } else {
        (false, None)
    };

    Ok(Json(GracePeriodStatusResponse {
        is_in_grace_period,
        is_blocked,
        days_remaining,
        grace_period_ends_at: earliest_grace_period_end.map(|t| {
            t.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        }),
        blocked_at: blocked_at.map(|t| {
            t.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        }),
        overdue_invoice_count: overdue_count,
        overdue_amount_cents: overdue_amount,
    }))
}
