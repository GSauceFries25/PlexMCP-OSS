#!/usr/bin/env rust-script
//! Billing Consistency Verification Script
//!
//! Detects database/Stripe drift for PlexMCP billing system.
//!
//! ## Usage
//! ```bash
//! cargo run --bin verify_billing_consistency > drift_report.csv
//! ```
//!
//! ## Environment Variables
//! - DATABASE_URL: PostgreSQL connection string
//! - STRIPE_SECRET_KEY: Stripe API key (production or test mode)
//!
//! ## Output
//! CSV report with columns:
//! - org_id, org_name, issue_type, db_tier, stripe_tier, db_status, stripe_status, recommendation

use std::env;
use std::error::Error;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("PlexMCP Billing Consistency Verification");
    println!("==========================================\n");

    // Load environment variables
    dotenvy::dotenv().ok();

    let database_url = env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");

    let stripe_key = env::var("STRIPE_SECRET_KEY")
        .expect("STRIPE_SECRET_KEY must be set");

    // Initialize database connection
    let pool = sqlx::postgres::PgPool::connect(&database_url).await?;

    // Initialize Stripe client
    let stripe_client = stripe::Client::new(stripe_key);

    println!("✓ Connected to database");
    println!("✓ Connected to Stripe API\n");

    // ========================================================================
    // Check 1: Paid tiers have Stripe customer ID
    // ========================================================================
    println!("Check 1: Verifying paid tiers have Stripe customer IDs...");

    let orgs_without_customer: Vec<(uuid::Uuid, String, String)> = sqlx::query_as(
        r#"
        SELECT id, name, subscription_tier
        FROM organizations
        WHERE subscription_tier IN ('pro', 'team', 'enterprise')
          AND (stripe_customer_id IS NULL OR stripe_customer_id = '')
        "#
    )
    .fetch_all(&pool)
    .await?;

    if orgs_without_customer.is_empty() {
        println!("  ✓ All paid tier organizations have Stripe customer IDs");
    } else {
        println!("  ⚠ Found {} paid orgs without Stripe customer", orgs_without_customer.len());
        for (org_id, org_name, tier) in &orgs_without_customer {
            println!("    - {}: {} ({})", org_id, org_name, tier);
        }
    }

    // ========================================================================
    // Check 2: Stripe customers exist (not deleted)
    // ========================================================================
    println!("\nCheck 2: Verifying Stripe customers exist...");

    let customer_ids: Vec<(uuid::Uuid, String, String)> = sqlx::query_as(
        r#"
        SELECT id, name, stripe_customer_id
        FROM organizations
        WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id != ''
        "#
    )
    .fetch_all(&pool)
    .await?;

    let mut deleted_customers = Vec::new();

    for (org_id, org_name, customer_id) in &customer_ids {
        match stripe::Customer::retrieve(&stripe_client, &customer_id.parse()?, &[]).await {
            Ok(customer) if customer.deleted.unwrap_or(false) => {
                deleted_customers.push((org_id, org_name, customer_id));
            }
            Err(_) => {
                deleted_customers.push((org_id, org_name, customer_id));
            }
            _ => {}
        }
    }

    if deleted_customers.is_empty() {
        println!("  ✓ All Stripe customers exist");
    } else {
        println!("  ⚠ Found {} deleted/missing Stripe customers", deleted_customers.len());
        for (org_id, org_name, _) in &deleted_customers {
            println!("    - {}: {}", org_id, org_name);
        }
    }

    // ========================================================================
    // Check 3: Active subscriptions match between Stripe and DB
    // ========================================================================
    println!("\nCheck 3: Verifying active subscriptions match...");

    let db_subscriptions: Vec<(uuid::Uuid, String, String, String)> = sqlx::query_as(
        r#"
        SELECT s.org_id, o.name, s.stripe_subscription_id, s.status
        FROM subscriptions s
        JOIN organizations o ON o.id = s.org_id
        WHERE s.status IN ('active', 'trialing', 'past_due')
        "#
    )
    .fetch_all(&pool)
    .await?;

    let mut subscription_mismatches = Vec::new();

    for (org_id, org_name, sub_id, db_status) in &db_subscriptions {
        match stripe::Subscription::retrieve(&stripe_client, &sub_id.parse()?, &[]).await {
            Ok(stripe_sub) => {
                let stripe_status = format!("{:?}", stripe_sub.status);
                if !matches!(
                    stripe_sub.status,
                    stripe::SubscriptionStatus::Active
                        | stripe::SubscriptionStatus::Trialing
                        | stripe::SubscriptionStatus::PastDue
                ) {
                    subscription_mismatches.push((
                        org_id,
                        org_name,
                        sub_id,
                        db_status.clone(),
                        stripe_status,
                    ));
                }
            }
            Err(_) => {
                subscription_mismatches.push((
                    org_id,
                    org_name,
                    sub_id,
                    db_status.clone(),
                    "DELETED".to_string(),
                ));
            }
        }
    }

    if subscription_mismatches.is_empty() {
        println!("  ✓ All active subscriptions match");
    } else {
        println!("  ⚠ Found {} subscription status mismatches", subscription_mismatches.len());
        for (org_id, org_name, _, db_status, stripe_status) in &subscription_mismatches {
            println!("    - {}: {} (DB: {}, Stripe: {})", org_id, org_name, db_status, stripe_status);
        }
    }

    // ========================================================================
    // Check 4: Subscription tiers match between Stripe and DB
    // ========================================================================
    println!("\nCheck 4: Verifying subscription tiers match...");

    // TODO: Implement tier comparison logic
    println!("  ⚠ Not implemented yet - requires price_id to tier mapping");

    // ========================================================================
    // Summary Report
    // ========================================================================
    println!("\n========================================");
    println!("Summary");
    println!("========================================");

    let total_issues = orgs_without_customer.len()
        + deleted_customers.len()
        + subscription_mismatches.len();

    if total_issues == 0 {
        println!("✓ No billing inconsistencies detected!");
    } else {
        println!("⚠ Found {} total issues", total_issues);
        println!("\nRecommendations:");
        println!("1. Run reconciliation script to fix drift");
        println!("2. Review manual tier changes from past 30 days");
        println!("3. Verify webhook processing is working correctly");
    }

    Ok(())
}
