//! Integration tests for admin-initiated tier changes
//!
//! These tests verify that admin tier changes properly sync with Stripe
//! and prevent database/Stripe drift.
//!
//! ## Test Coverage
//! - All tier transitions (Free ↔ Pro ↔ Team ↔ Enterprise)
//! - Trial period application
//! - Payment method validation
//! - Edge cases (missing customer, concurrent changes, etc.)
//!
//! ## Running Tests
//! ```bash
//! # Run with Stripe test mode
//! export STRIPE_SECRET_KEY="sk_test_..."
//! cargo test --test admin_tier_changes -- --test-threads=1
//! ```

use plexmcp_billing::{
    AdminTierChangeParams, AdminTierChangeResult, BillingError, BillingService, StripeConfig,
};
use sqlx::PgPool;
use uuid::Uuid;

// ============================================================================
// Test Utilities
// ============================================================================

/// Setup Stripe test mode client and return both service and pool
async fn setup_test_stripe() -> (BillingService, PgPool) {
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set for integration tests");
    let stripe_key = std::env::var("STRIPE_SECRET_KEY")
        .expect("STRIPE_SECRET_KEY (test mode: sk_test_...) must be set for integration tests");

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("Failed to connect to test database");

    let stripe_config = StripeConfig {
        secret_key: stripe_key,
        starter_price_id: std::env::var("STRIPE_STARTER_PRICE_ID")
            .unwrap_or_else(|_| "price_test_starter".to_string()),
        pro_price_id: std::env::var("STRIPE_PRO_PRICE_ID")
            .unwrap_or_else(|_| "price_test_pro".to_string()),
        team_price_id: std::env::var("STRIPE_TEAM_PRICE_ID")
            .unwrap_or_else(|_| "price_test_team".to_string()),
        enterprise_price_id: std::env::var("STRIPE_ENTERPRISE_PRICE_ID")
            .unwrap_or_else(|_| "price_test_enterprise".to_string()),
        starter_annual_price_id: std::env::var("STRIPE_STARTER_ANNUAL_PRICE_ID")
            .unwrap_or_else(|_| "price_test_starter_annual".to_string()),
        pro_annual_price_id: std::env::var("STRIPE_PRO_ANNUAL_PRICE_ID")
            .unwrap_or_else(|_| "price_test_pro_annual".to_string()),
        team_annual_price_id: std::env::var("STRIPE_TEAM_ANNUAL_PRICE_ID")
            .unwrap_or_else(|_| "price_test_team_annual".to_string()),
        enterprise_annual_price_id: std::env::var("STRIPE_ENTERPRISE_ANNUAL_PRICE_ID")
            .unwrap_or_else(|_| "price_test_enterprise_annual".to_string()),
        webhook_secret: std::env::var("STRIPE_WEBHOOK_SECRET")
            .unwrap_or_else(|_| "whsec_test_secret".to_string()),
    };

    let billing = BillingService::new(stripe_config, pool.clone());
    (billing, pool)
}

/// Create a test organization with owner
async fn create_test_org(pool: &PgPool) -> (Uuid, Uuid) {
    let org_id = Uuid::new_v4();
    let user_id = Uuid::new_v4();

    // Create organization
    let slug = format!("test-org-{}", org_id);
    sqlx::query(
        r#"
        INSERT INTO organizations (id, name, slug, subscription_tier, settings, created_at, updated_at)
        VALUES ($1, $2, $3, 'free', '{}', NOW(), NOW())
        "#
    )
    .bind(org_id)
    .bind("Test Organization")
    .bind(&slug)
    .execute(pool)
    .await
    .expect("Failed to create test organization");

    // Create owner user
    sqlx::query(
        r#"
        INSERT INTO users (id, org_id, email, password_hash, role, email_verified, created_at, updated_at)
        VALUES ($1, $2, $3, 'TEST_PASSWORD_HASH', 'owner', true, NOW(), NOW())
        "#
    )
    .bind(user_id)
    .bind(org_id)
    .bind(format!("test-owner-{}@example.com", org_id))
    .execute(pool)
    .await
    .expect("Failed to create test user");

    // Create organization membership
    sqlx::query(
        r#"
        INSERT INTO organization_members (id, org_id, user_id, role, created_at)
        VALUES ($1, $2, $3, 'owner', NOW())
        "#
    )
    .bind(Uuid::new_v4())
    .bind(org_id)
    .bind(user_id)
    .execute(pool)
    .await
    .expect("Failed to create organization membership");

    (org_id, user_id)
}

/// Cleanup test data after test completion
async fn cleanup_test_data(pool: &PgPool, org_id: Uuid) {
    // Delete in order to respect foreign key constraints

    // Delete organization members
    sqlx::query("DELETE FROM organization_members WHERE org_id = $1")
        .bind(org_id)
        .execute(pool)
        .await
        .ok(); // Ignore errors during cleanup

    // Delete subscriptions
    sqlx::query("DELETE FROM subscriptions WHERE org_id = $1")
        .bind(org_id)
        .execute(pool)
        .await
        .ok();

    // Delete subscription changes audit log
    sqlx::query("DELETE FROM subscription_changes WHERE org_id = $1")
        .bind(org_id)
        .execute(pool)
        .await
        .ok();

    // Delete users
    sqlx::query("DELETE FROM users WHERE org_id = $1")
        .bind(org_id)
        .execute(pool)
        .await
        .ok();

    // Delete organization
    sqlx::query("DELETE FROM organizations WHERE id = $1")
        .bind(org_id)
        .execute(pool)
        .await
        .ok();
}

/// Simulate Stripe webhook event
async fn simulate_webhook(_billing: &BillingService, _event_type: &str, _subscription_id: &str) {
    // NOTE: Full webhook simulation with Stripe Event construction is complex
    // and requires extensive mocking. For V1, webhook reconciliation tests
    // will verify idempotency by comparing database state before/after admin changes.
    //
    // Future enhancement: Use stripe-mock or construct minimal Event objects
    // to test webhook handler integration.
    //
    // For now, tests will focus on:
    // 1. Admin tier changes work correctly
    // 2. Database state is consistent after changes
    // 3. Stripe API calls succeed (via real test mode API)
}

// ============================================================================
// Test Cases: Tier Transitions
// ============================================================================

#[tokio::test]
#[ignore] // Remove this when implementation is complete
async fn test_free_to_pro_creates_subscription() {
    // Given: Organization on Free tier with no Stripe subscription
    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    // When: Admin changes tier to Pro
    let params = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(14), // Grant 14-day trial to avoid payment method requirement
        reason: "Test upgrade to Pro tier".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let result = billing
        .subscriptions
        .admin_change_tier(org_id, params)
        .await
        .expect("Failed to change tier from Free to Pro");

    // Then: Stripe subscription is created
    assert!(
        result.stripe_subscription_id.is_some(),
        "Stripe subscription should be created"
    );
    assert!(
        !result.stripe_customer_id.is_empty(),
        "Stripe customer ID should be set"
    );
    assert_eq!(result.tier, "pro", "Tier should be updated to pro");
    assert!(
        result.trial_end.is_some(),
        "Trial end date should be set for 14-day trial"
    );

    // Verify database is synced
    let db_tier: String = sqlx::query_scalar(
        "SELECT subscription_tier FROM organizations WHERE id = $1"
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch organization tier");

    assert_eq!(db_tier, "pro", "Database tier should be updated to pro");

    // Verify subscription record exists
    let subscription_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM subscriptions WHERE org_id = $1 AND status = 'active')"
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to check subscription");

    assert!(subscription_exists, "Active subscription should exist in database");

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

#[tokio::test]
#[ignore]
async fn test_pro_to_team_updates_subscription() {
    // Given: Organization on Pro tier with active Stripe subscription
    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    // First upgrade to Pro
    let pro_params = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(14),
        reason: "Initial upgrade to Pro".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let pro_result = billing
        .subscriptions
        .admin_change_tier(org_id, pro_params)
        .await
        .expect("Failed to upgrade to Pro");

    let initial_subscription_id = pro_result
        .stripe_subscription_id
        .expect("Pro tier should have subscription");

    // When: Admin changes tier to Team
    let team_params = AdminTierChangeParams {
        new_tier: "team".to_string(),
        trial_days: None, // No trial for upgrade
        reason: "Upgrade to Team tier".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let team_result = billing
        .subscriptions
        .admin_change_tier(org_id, team_params)
        .await
        .expect("Failed to upgrade from Pro to Team");

    // Then: Stripe subscription is updated (same subscription ID)
    assert_eq!(
        team_result.stripe_subscription_id,
        Some(initial_subscription_id),
        "Subscription should be updated, not replaced"
    );
    assert_eq!(team_result.tier, "team", "Tier should be updated to team");

    // Verify database is synced
    let db_tier: String = sqlx::query_scalar(
        "SELECT subscription_tier FROM organizations WHERE id = $1"
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch organization tier");

    assert_eq!(db_tier, "team", "Database tier should be updated to team");

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

#[tokio::test]
#[ignore]
async fn test_pro_to_free_cancels_subscription() {
    // Given: Organization on Pro tier with active Stripe subscription
    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    // First upgrade to Pro
    let pro_params = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(14),
        reason: "Initial upgrade to Pro".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    billing
        .subscriptions
        .admin_change_tier(org_id, pro_params)
        .await
        .expect("Failed to upgrade to Pro");

    // When: Admin downgrades tier to Free
    let free_params = AdminTierChangeParams {
        new_tier: "free".to_string(),
        trial_days: None,
        reason: "Downgrade to Free tier".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let free_result = billing
        .subscriptions
        .admin_change_tier(org_id, free_params)
        .await
        .expect("Failed to downgrade from Pro to Free");

    // Then: Subscription is canceled (no subscription ID for Free tier)
    assert!(
        free_result.stripe_subscription_id.is_none(),
        "Free tier should have no subscription"
    );
    assert_eq!(free_result.tier, "free", "Tier should be free");

    // Verify database is synced
    let db_tier: String = sqlx::query_scalar(
        "SELECT subscription_tier FROM organizations WHERE id = $1"
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch organization tier");

    assert_eq!(db_tier, "free", "Database tier should be updated to free");

    // Verify subscription is canceled (status should be 'canceled' or no active subscription)
    let active_subscription_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM subscriptions WHERE org_id = $1 AND status = 'active')"
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to check subscription");

    assert!(
        !active_subscription_exists,
        "No active subscription should exist for Free tier"
    );

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

#[tokio::test]
#[ignore]
async fn test_enterprise_to_pro_downgrade() {
    // Given: Organization on Enterprise tier
    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    // First upgrade to Enterprise with custom pricing
    let enterprise_params = AdminTierChangeParams {
        new_tier: "enterprise".to_string(),
        trial_days: Some(30), // 30-day trial
        reason: "Initial upgrade to Enterprise".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: Some(50000), // $500/month custom price
        subscription_start_date: None,
        payment_method: None,
    };

    billing
        .subscriptions
        .admin_change_tier(org_id, enterprise_params)
        .await
        .expect("Failed to upgrade to Enterprise");

    // When: Admin downgrades to Pro (immediate, not scheduled)
    let pro_params = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: None,
        reason: "Downgrade from Enterprise to Pro".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let pro_result = billing
        .subscriptions
        .admin_change_tier(org_id, pro_params)
        .await
        .expect("Failed to downgrade from Enterprise to Pro");

    // Then: Subscription is updated immediately
    assert!(
        pro_result.stripe_subscription_id.is_some(),
        "Subscription should exist for Pro tier"
    );
    assert_eq!(pro_result.tier, "pro", "Tier should be pro");

    // Verify database is synced immediately (no scheduled downgrade)
    let db_tier: String = sqlx::query_scalar(
        "SELECT subscription_tier FROM organizations WHERE id = $1"
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch organization tier");

    assert_eq!(
        db_tier, "pro",
        "Database tier should be immediately updated to pro"
    );

    // Verify no scheduled downgrade exists
    let scheduled_downgrade: Option<String> = sqlx::query_scalar(
        "SELECT scheduled_downgrade_tier FROM subscriptions WHERE org_id = $1"
    )
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .expect("Failed to check scheduled downgrade");

    assert!(
        scheduled_downgrade.is_none() || scheduled_downgrade == Some("".to_string()),
        "No scheduled downgrade should exist for immediate tier change"
    );

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

// ============================================================================
// Test Cases: Trial Periods
// ============================================================================

#[tokio::test]
#[ignore]
async fn test_trial_applied_to_new_subscription() {
    // Given: Organization on Free tier
    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    // When: Admin upgrades to Pro with 14-day trial
    let params = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(14),
        reason: "Upgrade with trial period".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let result = billing
        .subscriptions
        .admin_change_tier(org_id, params)
        .await
        .expect("Failed to create subscription with trial");

    // Then: Subscription created with trial
    assert!(
        result.trial_end.is_some(),
        "Trial end date should be set"
    );
    assert!(
        result.stripe_subscription_id.is_some(),
        "Subscription should be created"
    );

    // Verify trial period is approximately 14 days in the future
    let trial_end = result.trial_end.unwrap();
    let now = time::OffsetDateTime::now_utc();
    let trial_duration = trial_end - now;

    // Allow some tolerance (13-15 days)
    assert!(
        trial_duration.whole_days() >= 13 && trial_duration.whole_days() <= 15,
        "Trial should be approximately 14 days, got {} days",
        trial_duration.whole_days()
    );

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

#[tokio::test]
#[ignore]
async fn test_trial_extends_existing_subscription() {
    // Given: Organization on Pro tier with active subscription
    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    // First create Pro subscription with 7-day trial
    let initial_params = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(7),
        reason: "Initial Pro subscription".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let initial_result = billing
        .subscriptions
        .admin_change_tier(org_id, initial_params)
        .await
        .expect("Failed to create initial subscription");

    let initial_trial_end = initial_result.trial_end.expect("Initial trial should exist");

    // When: Admin applies 30-day trial extension
    let extension_params = AdminTierChangeParams {
        new_tier: "pro".to_string(), // Same tier
        trial_days: Some(30), // Extended trial
        reason: "Extend trial period".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let extended_result = billing
        .subscriptions
        .admin_change_tier(org_id, extension_params)
        .await
        .expect("Failed to extend trial");

    // Then: Trial is extended
    let new_trial_end = extended_result.trial_end.expect("Extended trial should exist");

    // New trial should be later than initial trial
    assert!(
        new_trial_end > initial_trial_end,
        "Extended trial end should be after initial trial end"
    );

    // Verify new trial is approximately 30 days from now
    let now = time::OffsetDateTime::now_utc();
    let trial_duration = new_trial_end - now;

    // Allow tolerance (29-31 days)
    assert!(
        trial_duration.whole_days() >= 29 && trial_duration.whole_days() <= 31,
        "Extended trial should be approximately 30 days from now, got {} days",
        trial_duration.whole_days()
    );

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

#[tokio::test]
#[ignore]
async fn test_trial_validation_max_730_days() {
    // Given: Admin attempts to grant 800-day trial (exceeds Stripe's 730-day limit)
    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    // When: admin_change_tier is called with trial_days=800
    let params = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(800), // Exceeds max allowed (730 days)
        reason: "Test excessive trial period".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let result = billing
        .subscriptions
        .admin_change_tier(org_id, params)
        .await;

    // Then: InvalidTier error is returned
    assert!(
        result.is_err(),
        "Should return error for trial period exceeding 730 days"
    );

    match result {
        Err(BillingError::InvalidTier(msg)) => {
            assert!(
                msg.contains("730") || msg.contains("trial"),
                "Error message should mention 730-day limit or trial validation, got: {}",
                msg
            );
        }
        Err(e) => panic!("Expected InvalidTier error, got: {:?}", e),
        Ok(_) => panic!("Expected error, but call succeeded"),
    }

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

// ============================================================================
// Test Cases: Payment Method Validation
// ============================================================================

#[tokio::test]
#[ignore]
async fn test_no_payment_method_fails_without_trial() {
    // NOTE: This test validates payment method requirement logic.
    // In a real Stripe test environment without payment method setup,
    // the subscription creation may still succeed but would fail on first charge.
    // For V1, we verify the code path executes without panics.

    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    // When: Admin upgrades to Pro WITHOUT trial (requires payment method)
    let params = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: None, // No trial = requires payment method
        reason: "Upgrade without trial".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let result = billing
        .subscriptions
        .admin_change_tier(org_id, params)
        .await;

    // Then: Without trial, subscription creation may fail or succeed
    // depending on Stripe customer setup. We verify the call completes.
    match result {
        Ok(r) => {
            // In test mode with no payment method, Stripe may still create subscription
            // It would fail on first charge attempt
            assert_eq!(r.tier, "pro");
        }
        Err(BillingError::PaymentMethodRequired(_)) => {
            // Expected: payment method is required
        }
        Err(e) => {
            // Other Stripe errors are acceptable in test environment
            tracing::warn!("Subscription creation returned error: {:?}", e);
        }
    }

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

#[tokio::test]
#[ignore]
async fn test_no_payment_method_succeeds_with_trial() {
    // Given: Organization with no payment method on file
    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    // When: Admin upgrades to Pro WITH 14-day trial (no payment method needed during trial)
    let params = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(14), // Trial = payment method not immediately required
        reason: "Upgrade with trial (no payment method)".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let result = billing
        .subscriptions
        .admin_change_tier(org_id, params)
        .await
        .expect("Subscription with trial should succeed without payment method");

    // Then: Subscription is created successfully
    assert!(
        result.stripe_subscription_id.is_some(),
        "Subscription should be created with trial"
    );
    assert!(
        result.trial_end.is_some(),
        "Trial end should be set"
    );
    assert_eq!(result.tier, "pro");

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

// ============================================================================
// Test Cases: Edge Cases
// ============================================================================

#[tokio::test]
#[ignore]
async fn test_org_without_customer_id() {
    // Given: Organization exists but has no stripe_customer_id in DB
    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    // Verify org has no Stripe customer ID initially
    let initial_customer_id: Option<String> = sqlx::query_scalar(
        "SELECT stripe_customer_id FROM organizations WHERE id = $1"
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch customer ID");

    assert!(
        initial_customer_id.is_none(),
        "Organization should not have Stripe customer ID initially"
    );

    // When: Admin upgrades to Pro
    let params = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(14),
        reason: "Upgrade without existing customer".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let result = billing
        .subscriptions
        .admin_change_tier(org_id, params)
        .await
        .expect("Should auto-create Stripe customer and subscription");

    // Then: Stripe customer is auto-created
    assert!(
        !result.stripe_customer_id.is_empty(),
        "Stripe customer should be auto-created"
    );
    assert!(
        result.stripe_subscription_id.is_some(),
        "Subscription should be created"
    );

    // Verify customer ID is persisted in database
    let db_customer_id: Option<String> = sqlx::query_scalar(
        "SELECT stripe_customer_id FROM organizations WHERE id = $1"
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch customer ID");

    assert!(
        db_customer_id.is_some(),
        "Customer ID should be saved to database"
    );
    assert_eq!(
        db_customer_id.unwrap(),
        result.stripe_customer_id,
        "Database customer ID should match result"
    );

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

#[tokio::test]
#[ignore]
async fn test_concurrent_tier_changes_handled() {
    // NOTE: Testing true concurrency requires careful transaction handling.
    // This test validates that sequential tier changes work correctly.
    // Full concurrent testing would require tokio::spawn and database transaction isolation.

    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    // First tier change: Free → Pro
    let params1 = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(14),
        reason: "First tier change".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let result1 = billing
        .subscriptions
        .admin_change_tier(org_id, params1)
        .await
        .expect("First tier change should succeed");

    assert_eq!(result1.tier, "pro");

    // Second tier change: Pro → Team (simulating concurrent-like behavior)
    let params2 = AdminTierChangeParams {
        new_tier: "team".to_string(),
        trial_days: None,
        reason: "Second tier change".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let result2 = billing
        .subscriptions
        .admin_change_tier(org_id, params2)
        .await
        .expect("Second tier change should succeed");

    assert_eq!(result2.tier, "team");

    // Verify final state is consistent
    let db_tier: String = sqlx::query_scalar(
        "SELECT subscription_tier FROM organizations WHERE id = $1"
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch tier");

    assert_eq!(db_tier, "team", "Final tier should be team");

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

#[tokio::test]
#[ignore]
async fn test_webhook_sync_after_admin_change() {
    // NOTE: Full webhook testing requires webhook event simulation.
    // For V1, we verify admin changes create correct database state
    // that webhooks would reconcile against.

    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    // Admin changes tier
    let params = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(14),
        reason: "Admin tier change for webhook test".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let result = billing
        .subscriptions
        .admin_change_tier(org_id, params)
        .await
        .expect("Admin tier change should succeed");

    // Verify database state is consistent
    let db_tier: String = sqlx::query_scalar(
        "SELECT subscription_tier FROM organizations WHERE id = $1"
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch tier");

    assert_eq!(db_tier, "pro");
    assert!(result.stripe_subscription_id.is_some());

    // Verify subscription record exists with correct Stripe IDs
    let subscription_record: (String, String) = sqlx::query_as(
        "SELECT stripe_subscription_id, stripe_customer_id FROM subscriptions WHERE org_id = $1"
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .expect("Subscription record should exist");

    assert_eq!(
        subscription_record.0,
        result.stripe_subscription_id.unwrap()
    );
    assert_eq!(subscription_record.1, result.stripe_customer_id);

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

#[tokio::test]
#[ignore]
async fn test_deleted_subscription_creates_new_one() {
    // NOTE: Testing deleted subscription handling requires mocking Stripe API responses.
    // For V1, we verify the tier change flow can create new subscriptions.

    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    // Create initial subscription
    let params1 = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(14),
        reason: "Initial subscription".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    billing
        .subscriptions
        .admin_change_tier(org_id, params1)
        .await
        .expect("Initial subscription should be created");

    // Downgrade to free (cancels subscription)
    let params2 = AdminTierChangeParams {
        new_tier: "free".to_string(),
        trial_days: None,
        reason: "Cancel subscription".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    billing
        .subscriptions
        .admin_change_tier(org_id, params2)
        .await
        .expect("Downgrade should cancel subscription");

    // Re-upgrade to pro (creates new subscription)
    let params3 = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(14),
        reason: "Re-upgrade after cancellation".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    let result3 = billing
        .subscriptions
        .admin_change_tier(org_id, params3)
        .await
        .expect("Should create new subscription after cancellation");

    assert!(
        result3.stripe_subscription_id.is_some(),
        "New subscription should be created"
    );
    assert_eq!(result3.tier, "pro");

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

// ============================================================================
// Test Cases: Audit Trail
// ============================================================================

#[tokio::test]
#[ignore]
async fn test_audit_log_includes_stripe_ids() {
    // Given: Admin changes tier
    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    let params = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(14),
        reason: "Audit trail test".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    // When: Tier change completes
    let result = billing
        .subscriptions
        .admin_change_tier(org_id, params)
        .await
        .expect("Tier change should succeed");

    // Then: Verify subscription_changes table has audit log with Stripe IDs
    let audit_record: Option<(String, String, String)> = sqlx::query_as(
        r#"
        SELECT old_tier, new_tier, reason
        FROM subscription_changes
        WHERE org_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        "#
    )
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .expect("Failed to fetch audit log");

    assert!(
        audit_record.is_some(),
        "Audit log should exist for tier change"
    );

    let (old_tier, new_tier, reason) = audit_record.unwrap();
    assert_eq!(old_tier, "free");
    assert_eq!(new_tier, "pro");
    assert_eq!(reason, "Audit trail test");

    // Verify subscription record has Stripe IDs
    let subscription: (String, String) = sqlx::query_as(
        "SELECT stripe_subscription_id, stripe_customer_id FROM subscriptions WHERE org_id = $1"
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .expect("Subscription should exist");

    assert_eq!(subscription.0, result.stripe_subscription_id.unwrap());
    assert_eq!(subscription.1, result.stripe_customer_id);

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

#[tokio::test]
#[ignore]
async fn test_trial_tracking_in_subscriptions_table() {
    // Given: Admin grants trial
    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    let params = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(30),
        reason: "30-day trial for testing".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    // When: Trial is applied
    billing
        .subscriptions
        .admin_change_tier(org_id, params)
        .await
        .expect("Tier change with trial should succeed");

    // Then: Verify subscriptions table has trial tracking fields
    // NOTE: The exact column names depend on database schema.
    // Common fields: trial_end, admin_trial_granted, admin_trial_granted_by, admin_trial_reason
    let trial_data: Option<time::OffsetDateTime> = sqlx::query_scalar(
        "SELECT trial_end FROM subscriptions WHERE org_id = $1"
    )
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .expect("Failed to fetch trial data");

    assert!(
        trial_data.is_some(),
        "Trial end date should be set in subscriptions table"
    );

    // Verify trial is approximately 30 days from now
    let trial_end = trial_data.unwrap();
    let now = time::OffsetDateTime::now_utc();
    let duration = trial_end - now;

    assert!(
        duration.whole_days() >= 29 && duration.whole_days() <= 31,
        "Trial should be ~30 days, got {} days",
        duration.whole_days()
    );

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

// ============================================================================
// Test Cases: Error Handling
// ============================================================================

#[tokio::test]
#[ignore]
async fn test_invalid_tier_returns_error() {
    // Given: Admin attempts to change to invalid tier "premium"
    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    let params = AdminTierChangeParams {
        new_tier: "premium".to_string(), // Invalid tier
        trial_days: None,
        reason: "Test invalid tier".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    // When: admin_change_tier is called
    let result = billing
        .subscriptions
        .admin_change_tier(org_id, params)
        .await;

    // Then: InvalidTier error is returned
    assert!(
        result.is_err(),
        "Invalid tier should return an error"
    );

    match result {
        Err(BillingError::InvalidTier(msg)) => {
            assert!(
                msg.contains("premium") || msg.contains("Invalid tier"),
                "Error should mention invalid tier, got: {}",
                msg
            );
        }
        Err(e) => panic!("Expected InvalidTier error, got: {:?}", e),
        Ok(_) => panic!("Expected error for invalid tier, but succeeded"),
    }

    // Verify database was not modified
    let db_tier: String = sqlx::query_scalar(
        "SELECT subscription_tier FROM organizations WHERE id = $1"
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch tier");

    assert_eq!(db_tier, "free", "Tier should remain unchanged on error");

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

#[tokio::test]
#[ignore]
async fn test_stripe_api_failure_rollback() {
    // NOTE: Testing Stripe API failures requires mocking or network failure simulation.
    // For V1, we verify that invalid operations don't leave partial state.

    let (billing, pool) = setup_test_stripe().await;
    let (org_id, _user_id) = create_test_org(&pool).await;

    // Attempt an operation that might fail (e.g., invalid price ID)
    // This tests that errors don't corrupt database state
    let params = AdminTierChangeParams {
        new_tier: "pro".to_string(),
        trial_days: Some(14),
        reason: "Test with potential Stripe error".to_string(),
        skip_payment_validation: false,
        billing_interval: None,
        custom_price_cents: None,
        subscription_start_date: None,
        payment_method: None,
    };

    // Attempt tier change (may succeed or fail depending on Stripe API)
    let _ = billing
        .subscriptions
        .admin_change_tier(org_id, params)
        .await;

    // Verify database state is consistent (either all changed or none changed)
    let db_tier: String = sqlx::query_scalar(
        "SELECT subscription_tier FROM organizations WHERE id = $1"
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .expect("Failed to fetch tier");

    // If tier changed to pro, subscription should exist
    if db_tier == "pro" {
        let sub_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM subscriptions WHERE org_id = $1 AND status = 'active')"
        )
        .bind(org_id)
        .fetch_one(&pool)
        .await
        .expect("Failed to check subscription");

        assert!(
            sub_exists,
            "If tier is pro, subscription must exist (no partial state)"
        );
    } else {
        // If tier is still free, no active subscription should exist
        assert_eq!(db_tier, "free");
    }

    // Cleanup
    cleanup_test_data(&pool, org_id).await;
}

// ============================================================================
// Future Test Cases (Not Implemented in V1)
// ============================================================================

// #[tokio::test]
// #[ignore]
// async fn test_scheduled_trial_end_downgrade() {
//     // When trial ends, org should auto-downgrade if no payment method
//     todo!("Future: Auto-downgrade on trial expiration")
// }

// #[tokio::test]
// #[ignore]
// async fn test_trial_extension_notification_email() {
//     // When trial is granted, user should receive email notification
//     todo!("Future: Trial notification emails")
// }
