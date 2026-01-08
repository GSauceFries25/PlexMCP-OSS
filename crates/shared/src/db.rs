//! Database utilities and connection management

use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};
use std::{str::FromStr, time::Duration};

/// Create a database connection pool
/// Note: Disables statement cache for PgBouncer compatibility
/// Uses conservative connection limits to stay within Supabase Session Mode pool_size
/// (Session Mode typically allows 10-15 connections total across all clients)
pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    // Parse connection options and disable prepared statement cache
    // PgBouncer in transaction mode doesn't support prepared statements
    let options = PgConnectOptions::from_str(database_url)?.statement_cache_capacity(0);

    // IMPORTANT: Keep max_connections LOW for Supabase Session Mode
    // With 2 API machines + 1 worker = 3 instances * 3 connections = 9 max
    // This leaves headroom within Supabase's typical 10-15 connection limit
    PgPoolOptions::new()
        .max_connections(3)
        .min_connections(0)
        .acquire_timeout(Duration::from_secs(30))
        .idle_timeout(Duration::from_secs(60)) // Release idle connections faster
        .max_lifetime(Duration::from_secs(300)) // Recycle connections more frequently
        .connect_with(options)
        .await
}

/// Create a database connection pool for migrations with longer timeout
/// Migrations may take longer and need more time to acquire connections
/// Uses single connection since migrations run sequentially
pub async fn create_migration_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let options = PgConnectOptions::from_str(database_url)?.statement_cache_capacity(0);

    PgPoolOptions::new()
        .max_connections(1) // Only need 1 for sequential migrations
        .min_connections(0)
        .acquire_timeout(Duration::from_secs(120)) // 2 minutes for migrations
        .idle_timeout(Duration::from_secs(30)) // Release quickly after migration
        .max_lifetime(Duration::from_secs(180))
        .connect_with(options)
        .await
}

/// Run database migrations
pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("../../migrations").run(pool).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Requires database
    async fn test_create_pool() {
        let url = std::env::var("DATABASE_URL").expect("DATABASE_URL required");
        let pool = create_pool(&url).await.expect("Failed to create pool");
        assert!(pool.size() > 0);
    }
}
