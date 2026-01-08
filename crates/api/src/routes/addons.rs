//! Add-ons routes for subscription add-on management (Redesigned Dec 2024)
//!
//! Supports 7 add-on types across 2 categories with tier-based availability:
//!
//! ## Scale Your Plan (capacity/overflow)
//! - request_pack (+25K): $8/mo (stackable, Free max 1)
//! - burst_mode (2x rate): $15/mo (Pro+ only)
//!
//! ## Enhance Your Workflow (features)
//! - analytics_pro: $12/mo (Pro+ only, included Team+)
//! - webhook_notifications: $8/mo (all tiers)
//! - custom_domain: $15/mo (Pro+ only)
//! - security_suite: $20/mo (Pro+ only)
//! - extended_retention: $10/mo (Pro+ only)
//!
//! ## Price Cap
//! Free tier users are capped at $15/mo in add-ons to encourage Pro upgrade at $29/mo.

use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use plexmcp_billing::{AddonCategory, AddonType};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth::AuthUser, error::ApiError, state::AppState};

/// Add-on info response
#[derive(Debug, Serialize)]
pub struct AddonInfo {
    pub id: Uuid,
    pub addon_type: String,
    pub name: String,
    pub status: String,
    pub price_cents: i32,
    pub quantity: i32,
    pub created_at: String,
}

/// List of available add-ons with their status
#[derive(Debug, Serialize)]
pub struct AddonsListResponse {
    pub addons: Vec<AddonStatus>,
    pub tier_includes_all: bool,
    pub can_purchase: bool,
    /// Current tier name
    pub tier: String,
    /// Add-on spend tracking (for Free tier price cap)
    pub spend_info: AddonSpendInfo,
}

/// Individual add-on status
#[derive(Debug, Serialize)]
pub struct AddonStatus {
    pub addon_type: String,
    pub name: String,
    pub description: String,
    pub price_cents: i32,
    pub category: String,
    pub is_stackable: bool,
    pub is_popular: bool,
    pub enabled: bool,
    pub quantity: i32,
    pub included_in_tier: bool,
    /// Whether addon is available for purchase at this tier
    pub available_for_tier: bool,
    /// Whether this is a Pro+ only addon (not available for Free)
    pub is_pro_only: bool,
    /// Message explaining availability (e.g., "Upgrade to Pro to unlock")
    pub availability_message: Option<String>,
}

/// Response for add-on spend tracking
#[derive(Debug, Serialize)]
pub struct AddonSpendInfo {
    /// Current monthly add-on spend in cents
    pub current_spend_cents: i32,
    /// Price cap in cents (for Free tier)
    pub price_cap_cents: Option<i32>,
    /// Whether at or over price cap
    pub at_price_cap: bool,
    /// Suggested upgrade message
    pub upgrade_message: Option<String>,
}

/// Response for enabling an add-on - can be either success or checkout required
#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum EnableAddonResponse {
    /// Add-on enabled successfully
    #[serde(rename = "success")]
    Success(AddonInfo),
    /// Checkout required (no payment method on file)
    #[serde(rename = "checkout_required")]
    CheckoutRequired {
        /// Stripe checkout session ID
        session_id: String,
        /// URL to redirect user to complete payment
        checkout_url: String,
        /// Message explaining why checkout is needed
        message: String,
    },
}

/// Free tier addon price cap in cents ($15) - encourages Pro upgrade at $29
const FREE_TIER_ADDON_CAP_CENTS: i32 = 1500;

/// Request to enable an add-on (with optional quantity for stackable add-ons)
#[derive(Debug, Deserialize)]
pub struct EnableAddonRequest {
    pub quantity: Option<u32>,
}

/// Request to update add-on quantity
#[derive(Debug, Deserialize)]
pub struct UpdateAddonQuantityRequest {
    pub quantity: u32,
}

fn category_to_string(cat: AddonCategory) -> String {
    match cat {
        // New 2-category system
        AddonCategory::Scale => "scale".to_string(),
        AddonCategory::Enhance => "enhance".to_string(),
        // Legacy categories (for existing data)
        AddonCategory::ResourcePacks => "resource_packs".to_string(),
        AddonCategory::Features => "features".to_string(),
        AddonCategory::Premium => "premium".to_string(),
    }
}

/// List all add-ons with their current status for the organization
pub async fn list_addons(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<AddonsListResponse>, ApiError> {
    // Use org_id if available, otherwise use user_id as the customer_id
    let org_id = auth_user
        .org_id
        .or(auth_user.user_id)
        .ok_or(ApiError::NoOrganization)?;

    tracing::info!(
        org_id = %org_id,
        "list_addons: starting"
    );

    // Get the subscription tier from the organizations table
    let tier_result: Option<(String,)> = sqlx::query_as(
        "SELECT COALESCE(subscription_tier, 'free') as tier FROM organizations
         WHERE id = $1
         LIMIT 1",
    )
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Database(format!("Database error: {}", e)))?;

    let tier = tier_result
        .map(|(t,)| t)
        .unwrap_or_else(|| "free".to_string());

    tracing::info!(
        org_id = %org_id,
        tier = %tier,
        "list_addons: got tier from organizations table"
    );

    // Check tier capabilities
    let tier_includes_all = matches!(tier.as_str(), "team" | "enterprise");
    // Free, Starter, and Pro can purchase add-ons
    let can_purchase = matches!(tier.as_str(), "free" | "starter" | "pro");
    let is_free_tier = matches!(tier.as_str(), "free" | "starter");

    // Get active add-ons for this organization with quantities and prices
    let active_addons: Vec<(String, Option<i32>, Option<i32>)> = sqlx::query_as(
        "SELECT addon_type, COALESCE(quantity, 1), unit_price_cents FROM subscription_addons
         WHERE org_id = $1 AND status = 'active'",
    )
    .bind(org_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    // Build lookup map of addon_type -> quantity and calculate current spend
    let mut addon_quantities: std::collections::HashMap<String, i32> =
        std::collections::HashMap::new();
    let mut current_spend_cents: i32 = 0;

    for (addon_type_str, qty, price) in active_addons {
        let quantity = qty.unwrap_or(1);
        addon_quantities.insert(addon_type_str.clone(), quantity);

        // Calculate spend: use stored price or look up current price
        let unit_price = price.unwrap_or_else(|| {
            AddonType::from_str(&addon_type_str)
                .map(|a| a.price_cents())
                .unwrap_or(0)
        });
        current_spend_cents += unit_price * quantity;
    }

    // Calculate spend info
    let price_cap_cents = if is_free_tier {
        Some(FREE_TIER_ADDON_CAP_CENTS)
    } else {
        None
    };
    let at_price_cap = is_free_tier && current_spend_cents >= FREE_TIER_ADDON_CAP_CENTS;

    let upgrade_message = if is_free_tier {
        if current_spend_cents >= FREE_TIER_ADDON_CAP_CENTS {
            Some("You've hit the add-on cap. Upgrade to Pro for $29/mo to get unlimited access plus all add-ons!".to_string())
        } else if current_spend_cents >= 2000 {
            Some(format!(
                "You're spending ${:.0}/mo on add-ons. Pro is ${:.0}/mo and includes Priority Support & Analytics Pro!",
                current_spend_cents as f64 / 100.0,
                FREE_TIER_ADDON_CAP_CENTS as f64 / 100.0
            ))
        } else if current_spend_cents >= 1500 {
            Some("Pro includes Analytics Pro + Priority Support and 50x more requests".to_string())
        } else {
            None
        }
    } else {
        None
    };

    let spend_info = AddonSpendInfo {
        current_spend_cents,
        price_cap_cents,
        at_price_cap,
        upgrade_message,
    };

    // Build response with all available add-ons
    let addons: Vec<AddonStatus> = AddonType::all()
        .into_iter()
        .map(|addon_type| {
            let type_str = addon_type.as_str().to_string();
            let quantity = addon_quantities.get(&type_str).copied().unwrap_or(0);

            // Check tier availability
            let (available, included) = addon_type.availability_for_tier(&tier);
            let enabled = included || quantity > 0;

            // Build availability message for locked add-ons
            let availability_message = if !available {
                Some("Upgrade to Pro to unlock".to_string())
            } else if addon_type.is_included_in_pro()
                && !matches!(tier.as_str(), "pro" | "team" | "enterprise")
            {
                Some("Included free with Pro".to_string())
            } else {
                None
            };

            // Log custom_domain addon details
            if addon_type == AddonType::CustomDomain {
                tracing::info!(
                    org_id = %org_id,
                    tier = %tier,
                    quantity = quantity,
                    available = available,
                    included = included,
                    enabled = enabled,
                    "list_addons: custom_domain addon status"
                );
            }

            AddonStatus {
                addon_type: type_str,
                name: addon_type.display_name().to_string(),
                description: addon_type.description().to_string(),
                price_cents: addon_type.price_cents(),
                category: category_to_string(addon_type.category()),
                is_stackable: addon_type.is_stackable(),
                is_popular: addon_type.is_popular(),
                enabled,
                quantity: if included { 1 } else { quantity },
                included_in_tier: included,
                available_for_tier: available,
                is_pro_only: addon_type.is_pro_only(),
                availability_message,
            }
        })
        .collect();

    tracing::info!(
        org_id = %org_id,
        tier = %tier,
        addon_count = addons.len(),
        "list_addons: returning response"
    );

    Ok(Json(AddonsListResponse {
        addons,
        tier_includes_all,
        can_purchase,
        tier: tier.clone(),
        spend_info,
    }))
}

/// Enable an add-on for the organization
pub async fn enable_addon(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(addon_type): Path<String>,
    Json(request): Json<EnableAddonRequest>,
) -> Result<Json<EnableAddonResponse>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user
        .org_id
        .or(auth_user.user_id)
        .ok_or(ApiError::NoOrganization)?;

    // Validate addon type
    let addon = plexmcp_billing::AddonType::from_str(&addon_type)
        .ok_or_else(|| ApiError::BadRequest(format!("Invalid addon type: {}", addon_type)))?;

    // Check if user can purchase add-ons (Free, Starter, Pro can purchase)
    let tier_result: Option<(String,)> = sqlx::query_as(
        "SELECT COALESCE(subscription_tier, 'free') as tier FROM organizations
         WHERE id = $1
         LIMIT 1",
    )
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Database(format!("Database error: {}", e)))?;

    let tier = tier_result
        .map(|(t,)| t)
        .unwrap_or_else(|| "free".to_string());
    let is_free_tier = matches!(tier.as_str(), "free" | "starter");

    // Team/Enterprise get add-ons free, Free/Starter/Pro can purchase
    if matches!(tier.as_str(), "team" | "enterprise") {
        return Err(ApiError::BadRequest(
            "Add-ons are already included in your plan".to_string(),
        ));
    }

    // Check tier availability for this add-on
    let (available, included) = addon.availability_for_tier(&tier);
    if included {
        return Err(ApiError::BadRequest(format!(
            "{} is already included in your {} plan",
            addon.display_name(),
            tier
        )));
    }
    if !available {
        return Err(ApiError::BadRequest(format!(
            "{} requires Pro tier or higher. Upgrade to unlock this add-on.",
            addon.display_name()
        )));
    }

    // Validate quantity for stackable add-ons
    let quantity = request.quantity.unwrap_or(1).max(1);
    if !addon.is_stackable() && quantity > 1 {
        return Err(ApiError::BadRequest(format!(
            "{} is not stackable - quantity must be 1",
            addon.display_name()
        )));
    }

    // For Free tier, check price cap before allowing purchase
    if is_free_tier {
        // Calculate current spend
        let active_addons: Vec<(String, Option<i32>, Option<i32>)> = sqlx::query_as(
            "SELECT addon_type, COALESCE(quantity, 1), unit_price_cents FROM subscription_addons
             WHERE org_id = $1 AND status = 'active'",
        )
        .bind(org_id)
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default();

        let mut current_spend_cents: i32 = 0;

        for (addon_type_str, qty, price) in active_addons {
            let qty_val = qty.unwrap_or(1);
            let unit_price = price.unwrap_or_else(|| {
                AddonType::from_str(&addon_type_str)
                    .map(|a| a.price_cents())
                    .unwrap_or(0)
            });
            current_spend_cents += unit_price * qty_val;
        }

        // Calculate new spend after this purchase
        // For stackable addons, quantity is additive in enable_addon
        let additional_quantity = quantity as i32;
        let new_addon_cost = addon.price_cents() * additional_quantity;
        let new_total_spend = current_spend_cents + new_addon_cost;

        if new_total_spend > FREE_TIER_ADDON_CAP_CENTS {
            return Err(ApiError::BadRequest(format!(
                "This would bring your add-on spend to ${:.2}/mo, exceeding the ${:.2} cap. \
                Upgrade to Pro for ${:.2}/mo to get unlimited add-ons plus Analytics Pro, Priority Support, and 50x more requests!",
                new_total_spend as f64 / 100.0,
                FREE_TIER_ADDON_CAP_CENTS as f64 / 100.0,
                FREE_TIER_ADDON_CAP_CENTS as f64 / 100.0
            )));
        }
    }

    // ALWAYS create a Stripe Checkout session for addon purchases
    // This ensures explicit user approval before charging
    tracing::info!(
        org_id = %org_id,
        addon_type = %addon_type,
        quantity = quantity,
        "Creating checkout session for addon purchase"
    );

    // Get the Stripe customer ID for this org
    let customer_id: Option<(Option<String>,)> =
        sqlx::query_as("SELECT stripe_customer_id FROM organizations WHERE id = $1")
            .bind(org_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::Database(format!("Database error: {}", e)))?;

    let customer_id = customer_id.and_then(|(c,)| c).ok_or_else(|| {
        ApiError::BadRequest("No Stripe customer found. Please set up billing first.".to_string())
    })?;

    // Get the price ID for this add-on
    let price_id = billing
        .subscriptions
        .stripe()
        .config()
        .addon_price_id(&addon_type)
        .ok_or_else(|| ApiError::BadRequest(format!("No price configured for {}", addon_type)))?;

    // Create a checkout session for this add-on
    let session = billing
        .checkout
        .create_addon_checkout(org_id, &customer_id, &addon_type, &price_id, quantity)
        .await
        .map_err(|e| {
            tracing::error!(
                org_id = %org_id,
                addon_type = %addon_type,
                error = %e,
                "Failed to create addon checkout session"
            );
            ApiError::Database(format!("Failed to create checkout: {}", e))
        })?;

    let checkout_url = session
        .url
        .ok_or_else(|| ApiError::Database("Checkout session has no URL".to_string()))?;

    Ok(Json(EnableAddonResponse::CheckoutRequired {
        session_id: session.id.to_string(),
        checkout_url,
        message: "Please complete payment to enable this add-on.".to_string(),
    }))
}

/// Disable an add-on for the organization
pub async fn disable_addon(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(addon_type): Path<String>,
) -> Result<StatusCode, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user
        .org_id
        .or(auth_user.user_id)
        .ok_or(ApiError::NoOrganization)?;

    // Validate addon type
    let addon = plexmcp_billing::AddonType::from_str(&addon_type)
        .ok_or_else(|| ApiError::BadRequest(format!("Invalid addon type: {}", addon_type)))?;

    // Create AddonService and disable
    let addon_service = plexmcp_billing::AddonService::new(
        billing.subscriptions.stripe().clone(),
        state.pool.clone(),
    );

    addon_service
        .disable_addon(org_id, addon)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to disable addon: {}", e)))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Check if organization has a specific add-on enabled
pub async fn check_addon(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(addon_type): Path<String>,
) -> Result<Json<bool>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user
        .org_id
        .or(auth_user.user_id)
        .ok_or(ApiError::NoOrganization)?;

    // Validate addon type
    let addon = plexmcp_billing::AddonType::from_str(&addon_type)
        .ok_or_else(|| ApiError::BadRequest(format!("Invalid addon type: {}", addon_type)))?;

    // First check if tier includes all add-ons
    let tier_result: Option<(String,)> = sqlx::query_as(
        "SELECT COALESCE(subscription_tier, 'free') as tier FROM organizations
         WHERE id = $1
         LIMIT 1",
    )
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Database(format!("Database error: {}", e)))?;

    let tier = tier_result
        .map(|(t,)| t)
        .unwrap_or_else(|| "free".to_string());

    // Team/Enterprise always have all add-ons
    if matches!(tier.as_str(), "team" | "enterprise") {
        return Ok(Json(true));
    }

    // Check if add-on is purchased
    let addon_service = plexmcp_billing::AddonService::new(
        billing.subscriptions.stripe().clone(),
        state.pool.clone(),
    );

    let has_addon = addon_service
        .has_addon(org_id, addon)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to check addon: {}", e)))?;

    Ok(Json(has_addon))
}

/// Update quantity of a stackable add-on
pub async fn update_addon_quantity(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
    Path(addon_type): Path<String>,
    Json(request): Json<UpdateAddonQuantityRequest>,
) -> Result<Json<AddonInfo>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user
        .org_id
        .or(auth_user.user_id)
        .ok_or(ApiError::NoOrganization)?;

    // Validate addon type
    let addon = plexmcp_billing::AddonType::from_str(&addon_type)
        .ok_or_else(|| ApiError::BadRequest(format!("Invalid addon type: {}", addon_type)))?;

    // Verify add-on is stackable
    if !addon.is_stackable() {
        return Err(ApiError::BadRequest(format!(
            "{} is not stackable - use enable/disable instead",
            addon.display_name()
        )));
    }

    // Validate quantity
    if request.quantity == 0 {
        return Err(ApiError::BadRequest(
            "Use disable endpoint to remove add-on entirely".to_string(),
        ));
    }

    // Check tier for price cap enforcement
    let tier_result: Option<(String,)> = sqlx::query_as(
        "SELECT COALESCE(subscription_tier, 'free') as tier FROM organizations
         WHERE id = $1
         LIMIT 1",
    )
    .bind(org_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Database(format!("Database error: {}", e)))?;

    let tier = tier_result
        .map(|(t,)| t)
        .unwrap_or_else(|| "free".to_string());
    let is_free_tier = matches!(tier.as_str(), "free" | "starter");

    // For Free tier, check price cap before allowing quantity increase
    if is_free_tier {
        // Calculate current spend (excluding this addon type)
        let active_addons: Vec<(String, Option<i32>, Option<i32>)> = sqlx::query_as(
            "SELECT addon_type, COALESCE(quantity, 1), unit_price_cents FROM subscription_addons
             WHERE org_id = $1 AND status = 'active'",
        )
        .bind(org_id)
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default();

        let mut other_spend_cents: i32 = 0;

        for (addon_type_str, qty, price) in active_addons {
            // Skip the addon we're updating - we'll calculate its new cost separately
            if addon_type_str == addon.as_str() {
                continue;
            }
            let qty_val = qty.unwrap_or(1);
            let unit_price = price.unwrap_or_else(|| {
                AddonType::from_str(&addon_type_str)
                    .map(|a| a.price_cents())
                    .unwrap_or(0)
            });
            other_spend_cents += unit_price * qty_val;
        }

        // Calculate new total with updated quantity
        let new_addon_cost = addon.price_cents() * request.quantity as i32;
        let new_total_spend = other_spend_cents + new_addon_cost;

        if new_total_spend > FREE_TIER_ADDON_CAP_CENTS {
            return Err(ApiError::BadRequest(format!(
                "This would bring your add-on spend to ${:.2}/mo, exceeding the ${:.2} cap. \
                Upgrade to Pro for ${:.2}/mo to get unlimited add-ons!",
                new_total_spend as f64 / 100.0,
                FREE_TIER_ADDON_CAP_CENTS as f64 / 100.0,
                FREE_TIER_ADDON_CAP_CENTS as f64 / 100.0
            )));
        }
    }

    // Create AddonService and update quantity
    let addon_service = plexmcp_billing::AddonService::new(
        billing.subscriptions.stripe().clone(),
        state.pool.clone(),
    );

    let result = addon_service
        .set_addon_quantity(org_id, addon, request.quantity)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to update addon quantity: {}", e)))?;

    Ok(Json(AddonInfo {
        id: result.id,
        addon_type: result.addon_type.clone(),
        name: plexmcp_billing::AddonType::from_str(&result.addon_type)
            .map(|a| a.display_name().to_string())
            .unwrap_or_else(|| result.addon_type.clone()),
        status: result.status,
        price_cents: result.unit_price_cents.unwrap_or(0),
        quantity: result.quantity.unwrap_or(1),
        created_at: result
            .created_at
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
    }))
}

/// Get add-on quantities for effective limits calculation
pub async fn get_addon_quantities(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<plexmcp_billing::AddonQuantities>, ApiError> {
    let billing = state.billing.as_ref().ok_or(ApiError::ServiceUnavailable)?;

    let org_id = auth_user
        .org_id
        .or(auth_user.user_id)
        .ok_or(ApiError::NoOrganization)?;

    let addon_service = plexmcp_billing::AddonService::new(
        billing.subscriptions.stripe().clone(),
        state.pool.clone(),
    );

    let quantities = addon_service
        .get_addon_quantities(org_id)
        .await
        .map_err(|e| ApiError::Database(format!("Failed to get addon quantities: {}", e)))?;

    Ok(Json(quantities))
}
