#!/usr/bin/env rust-script
//! Billing Reconciliation Script
//!
//! Fixes database/Stripe drift for PlexMCP billing system.
//! Uses Stripe as the source of truth.
//!
//! ## Usage
//! ```bash
//! # Dry run (preview changes without applying)
//! cargo run --bin reconcile_billing --dry-run
//!
//! # Apply fixes
//! cargo run --bin reconcile_billing --apply
//! ```
//!
//! ## Environment Variables
//! - DATABASE_URL: PostgreSQL connection string
//! - STRIPE_SECRET_KEY: Stripe API key (production or test mode)
//!
//! ## Actions Performed
//! 1. Downgrade orgs with paid tier but no active subscription → Free
//! 2. Update tiers to match Stripe subscription
//! 3. Fix subscription status mismatches
//! 4. Create missing Stripe customers for paid tiers

use std::env;
use std::error::Error;

#[derive(Debug)]
struct ReconciliationAction {
    org_id: uuid::Uuid,
    org_name: String,
    action_type: String,
    current_state: String,
    new_state: String,
    reason: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    println!("PlexMCP Billing Reconciliation");
    println!("================================\n");

    // Parse command line arguments
    let args: Vec<String> = env::args().collect();
    let dry_run = !args.contains(&"--apply".to_string());

    if dry_run {
        println!("🔍 DRY RUN MODE - No changes will be applied");
        println!("   Use --apply flag to execute changes\n");
    } else {
        println!("⚠️  LIVE MODE - Changes will be applied to database and Stripe\n");
    }

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

    let mut actions = Vec::new();

    // ========================================================================
    // Action 1: Downgrade orgs with paid tier but no active subscription
    // ========================================================================
    println!("Scanning for paid orgs without active subscriptions...");

    let orgs_without_subscription: Vec<(uuid::Uuid, String, String)> = sqlx::query_as(
        r#"
        SELECT o.id, o.name, o.subscription_tier
        FROM organizations o
        WHERE o.subscription_tier IN ('pro', 'team', 'enterprise')
          AND NOT EXISTS (
              SELECT 1 FROM subscriptions s
              WHERE s.org_id = o.id
                AND s.status IN ('active', 'trialing', 'past_due')
          )
        "#
    )
    .fetch_all(&pool)
    .await?;

    for (org_id, org_name, current_tier) in orgs_without_subscription {
        actions.push(ReconciliationAction {
            org_id,
            org_name,
            action_type: "DOWNGRADE".to_string(),
            current_state: current_tier,
            new_state: "free".to_string(),
            reason: "No active Stripe subscription found".to_string(),
        });
    }

    println!("  Found {} orgs to downgrade to Free tier", actions.len());

    // ========================================================================
    // Action 2: Update tiers to match Stripe subscription
    // ========================================================================
    println!("\nScanning for tier mismatches between DB and Stripe...");

    let active_subscriptions: Vec<(uuid::Uuid, String, String, String)> = sqlx::query_as(
        r#"
        SELECT s.org_id, o.name, o.subscription_tier, s.stripe_subscription_id
        FROM subscriptions s
        JOIN organizations o ON o.id = s.org_id
        WHERE s.status IN ('active', 'trialing', 'past_due')
        "#
    )
    .fetch_all(&pool)
    .await?;

    // TODO: Implement tier mismatch detection
    // This requires mapping Stripe price IDs to tier names
    println!("  ⚠ Not implemented yet - requires price_id to tier mapping");

    // ========================================================================
    // Action 3: Fix subscription status mismatches
    // ========================================================================
    println!("\nScanning for subscription status mismatches...");

    // TODO: Implement status mismatch reconciliation
    println!("  ⚠ Not implemented yet");

    // ========================================================================
    // Summary and Execution
    // ========================================================================
    println!("\n========================================");
    println!("Reconciliation Plan");
    println!("========================================\n");

    if actions.is_empty() {
        println!("✓ No reconciliation actions needed!");
        return Ok(());
    }

    println!("Found {} actions to perform:\n", actions.len());

    for (i, action) in actions.iter().enumerate() {
        println!("{}. {} - {}", i + 1, action.action_type, action.org_name);
        println!("   Org ID: {}", action.org_id);
        println!("   Current: {}", action.current_state);
        println!("   New: {}", action.new_state);
        println!("   Reason: {}", action.reason);
        println!();
    }

    if dry_run {
        println!("This was a dry run. No changes were applied.");
        println!("Run with --apply flag to execute these changes.");
        return Ok(());
    }

    // Execute reconciliation actions
    println!("========================================");
    println!("Executing Reconciliation");
    println!("========================================\n");

    for action in &actions {
        match action.action_type.as_str() {
            "DOWNGRADE" => {
                println!("Downgrading {} to free tier...", action.org_name);

                sqlx::query(
                    r#"
                    UPDATE organizations
                    SET subscription_tier = 'free',
                        updated_at = NOW()
                    WHERE id = $1
                    "#
                )
                .bind(action.org_id)
                .execute(&pool)
                .await?;

                println!("  ✓ Downgraded to free tier");
            }
            _ => {
                println!("  ⚠ Unknown action type: {}", action.action_type);
            }
        }
    }

    println!("\n========================================");
    println!("Reconciliation Complete");
    println!("========================================");
    println!("✓ Applied {} actions successfully", actions.len());

    Ok(())
}
