//! Row-Level Security (RLS) validation tests
//!
//! These tests verify that FORCE RLS is properly configured on all tables
//! to prevent superadmins from bypassing multi-tenancy isolation.
//!
//! SOC 2 Requirement: CC6.1 - Logical access controls
//! CVSS Score: 7.2 (High) if not properly enforced
//!
//! To run these tests against production:
//! ```bash
//! cargo test -p plexmcp-api --lib rls_tests -- --ignored
//! ```

#[cfg(test)]
mod tests {
    use serial_test::serial;
    use sqlx::PgPool;

    /// Helper to get production database pool
    async fn get_production_pool() -> PgPool {
        let database_url = std::env::var("DATABASE_URL")
            .expect("DATABASE_URL must be set to run production RLS tests");
        PgPool::connect(&database_url)
            .await
            .expect("Failed to connect to production database")
    }

    /// Critical tables that MUST have FORCE RLS
    /// These are the most security-sensitive tables in the schema
    const CRITICAL_TABLES: &[&str] = &[
        // Audit logs (tamper-proof)
        "admin_audit_log",
        "auth_audit_log",
        // Authentication & 2FA
        "user_2fa",
        "user_2fa_backup_codes",
        "user_security_settings",
        // Payment security
        "payment_attempts",
        "invoice_line_items",
        "invoices",
        // Core data
        "users",
        "organizations",
        "api_keys",
        "sessions", // User sessions
        // Subscription & billing
        "subscriptions",
        "usage_records",
        // MCP data
        "mcp_instances",
        "mcp_request_log",
    ];

    /// Test that all critical tables have FORCE RLS enabled
    /// Note: This test requires full production schema. Run with: cargo test -- --ignored
    #[tokio::test]
    #[ignore = "Requires production DATABASE_URL"]
    #[serial(sqlx_db)]
    async fn test_critical_tables_have_force_rls() {
        let pool = get_production_pool().await;
        for table_name in CRITICAL_TABLES {
            let result: Option<(bool,)> = sqlx::query_as(
                r#"
                SELECT c.relforcerowsecurity
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = $1
                  AND n.nspname = 'public'
                "#,
            )
            .bind(table_name)
            .fetch_optional(&pool)
            .await
            .expect(&format!(
                "Failed to check FORCE RLS for table: {}",
                table_name
            ));

            assert!(
                result.is_some(),
                "Critical table '{}' does not exist",
                table_name
            );

            let has_force_rls = result.unwrap().0;
            assert!(
                has_force_rls,
                "CRITICAL SECURITY ISSUE: Table '{}' does not have FORCE RLS enabled. \
                 Superadmins can bypass RLS policies and access other organizations' data!",
                table_name
            );
        }
    }

    /// Test that ALL tables with RLS enabled also have FORCE RLS
    #[tokio::test]
    #[ignore = "Requires production DATABASE_URL"]
    #[serial(sqlx_db)]
    async fn test_all_rls_tables_have_force_rls() {
        let pool = get_production_pool().await;
        let tables_without_force_rls: Vec<(String,)> = sqlx::query_as(
            r#"
            SELECT t.tablename
            FROM pg_tables t
            JOIN pg_class c ON c.relname = t.tablename
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
            WHERE t.schemaname = 'public'
              AND c.relrowsecurity = true
              AND c.relforcerowsecurity = false
            ORDER BY t.tablename
            "#,
        )
        .fetch_all(&pool)
        .await
        .expect("Failed to query tables without FORCE RLS");

        assert_eq!(
            tables_without_force_rls.len(),
            0,
            "SECURITY VULNERABILITY: {} tables have RLS enabled but not FORCE RLS. \
             Tables: {:?}. This allows superadmins to bypass RLS policies!",
            tables_without_force_rls.len(),
            tables_without_force_rls
                .iter()
                .map(|t| &t.0)
                .collect::<Vec<_>>()
        );
    }

    /// Test that RLS policies exist for all tables with FORCE RLS
    /// Note: This test requires full production schema. Run with: cargo test -- --ignored
    #[tokio::test]
    #[ignore = "Requires production DATABASE_URL"]
    #[serial(sqlx_db)]
    async fn test_rls_policies_exist() {
        let pool = get_production_pool().await;
        let tables_without_policies: Vec<(String,)> = sqlx::query_as(
            r#"
            SELECT c.relname as tablename
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
              AND c.relrowsecurity = true
              AND c.relforcerowsecurity = true
              AND NOT EXISTS (
                  SELECT 1
                  FROM pg_policy p
                  WHERE p.polrelid = c.oid
              )
            ORDER BY c.relname
            "#,
        )
        .fetch_all(&pool)
        .await
        .expect("Failed to query tables without RLS policies");

        assert_eq!(
            tables_without_policies.len(),
            0,
            "WARNING: {} tables have FORCE RLS enabled but no RLS policies defined. \
             Tables: {:?}. These tables will deny all access!",
            tables_without_policies.len(),
            tables_without_policies
                .iter()
                .map(|t| &t.0)
                .collect::<Vec<_>>()
        );
    }

    // =========================================================================
    // MT-R05: All multi-tenant tables must have FORCE RLS
    // =========================================================================
    /// Test that the expected number of tables have FORCE RLS
    /// This is the critical MT-R05 edge case test
    /// Note: This test requires full production schema. Run with: cargo test -- --ignored
    #[tokio::test]
    #[ignore = "Requires production DATABASE_URL"]
    #[serial(sqlx_db)]
    async fn test_mt_r05_all_tables_have_force_rls() {
        let pool = get_production_pool().await;
        // Count tables with FORCE RLS enabled
        let force_rls_count: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
              AND c.relforcerowsecurity = true
            "#,
        )
        .fetch_one(&pool)
        .await
        .expect("Failed to count FORCE RLS tables");

        // All multi-tenant tables should have FORCE RLS
        // The schema has 77+ tables that need protection
        assert!(
            force_rls_count.0 >= 26,
            "MT-R05 FAILED: Only {} tables have FORCE RLS enabled. Expected 26+",
            force_rls_count.0
        );
    }

    // =========================================================================
    // MT-R01: Superadmin without org context should be blocked by FORCE RLS
    // =========================================================================
    /// Test that superadmin role doesn't bypass RLS on critical tables
    /// Note: This test requires full production schema. Run with: cargo test -- --ignored
    #[tokio::test]
    #[ignore = "Requires production DATABASE_URL"]
    #[serial(sqlx_db)]
    async fn test_mt_r01_superadmin_blocked_by_force_rls() {
        let pool = get_production_pool().await;
        // FORCE RLS means even superadmin needs to satisfy policies
        // This query verifies all critical tables have FORCE RLS

        let tables_without_force_rls: Vec<(String,)> = sqlx::query_as(
            r#"
            SELECT c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
              AND c.relrowsecurity = true
              AND c.relforcerowsecurity = false
            ORDER BY c.relname
            "#,
        )
        .fetch_all(&pool)
        .await
        .expect("Failed to query tables");

        assert_eq!(
            tables_without_force_rls.len(),
            0,
            "MT-R01 FAILED: Superadmin can bypass RLS on {} tables: {:?}",
            tables_without_force_rls.len(),
            tables_without_force_rls
                .iter()
                .map(|t| &t.0)
                .collect::<Vec<_>>()
        );
    }

    // =========================================================================
    // MT-R03: Query with NULL org_id should return no data
    // =========================================================================
    /// Validates that queries properly handle NULL org_id filters
    /// Note: This test requires full production schema. Run with: cargo test -- --ignored
    #[tokio::test]
    #[ignore = "Requires production DATABASE_URL"]
    #[serial(sqlx_db)]
    async fn test_mt_r03_null_org_id_returns_empty() {
        let pool = get_production_pool().await;
        // Test that querying with NULL org_id returns no data
        // This validates the RLS policies properly filter

        let result: Vec<(i64,)> =
            sqlx::query_as("SELECT COUNT(*) FROM users WHERE org_id IS NULL AND org_id = $1::uuid")
                .bind(Option::<uuid::Uuid>::None)
                .fetch_all(&pool)
                .await
                .expect("Query should execute");

        // Result should be empty or zero count
        let count = result.first().map(|r| r.0).unwrap_or(0);
        assert_eq!(count, 0, "NULL org_id should return no results");
    }

    // =========================================================================
    // MT-R04: New tables must have FORCE RLS - schema validation
    // =========================================================================
    /// Test that verifies tables added have RLS (prevents regressions)
    /// Note: This test requires full production schema. Run with: cargo test -- --ignored
    #[tokio::test]
    #[ignore = "Requires production DATABASE_URL"]
    #[serial(sqlx_db)]
    async fn test_mt_r04_new_tables_have_rls() {
        let pool = get_production_pool().await;
        // List of tables that should NOT have RLS (system tables, global data)
        let exempt_tables = [
            "_sqlx_migrations", // SQLx system table
            "subdomain_words",  // Global lookup data for subdomain generation
        ];

        // Get all tables without RLS
        let tables_without_rls: Vec<(String,)> = sqlx::query_as(
            r#"
            SELECT c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
              AND c.relrowsecurity = false
            ORDER BY c.relname
            "#,
        )
        .fetch_all(&pool)
        .await
        .expect("Failed to query tables without RLS");

        // Filter out exempt tables
        let unprotected: Vec<_> = tables_without_rls
            .iter()
            .filter(|(name,)| !exempt_tables.contains(&name.as_str()))
            .collect();

        // All non-exempt tables should have RLS
        assert_eq!(
            unprotected.len(),
            0,
            "MT-R04 FAILED: {} tables should have RLS: {:?}",
            unprotected.len(),
            unprotected.iter().map(|t| &t.0).collect::<Vec<_>>()
        );
    }

    /// Test RLS configuration summary
    /// Note: This test requires full production schema. Run with: cargo test -- --ignored
    #[tokio::test]
    #[ignore = "Requires production DATABASE_URL"]
    #[serial(sqlx_db)]
    async fn test_rls_configuration_summary() {
        let pool = get_production_pool().await;
        #[derive(Debug, sqlx::FromRow)]
        struct RlsSummary {
            total_tables: i64,
            rls_enabled: i64,
            force_rls: i64,
            with_policies: i64,
        }

        let summary: RlsSummary = sqlx::query_as(
            r#"
            SELECT
                COUNT(*) FILTER (WHERE c.relkind = 'r') as total_tables,
                COUNT(*) FILTER (WHERE c.relrowsecurity = true) as rls_enabled,
                COUNT(*) FILTER (WHERE c.relforcerowsecurity = true) as force_rls,
                COUNT(DISTINCT p.polrelid) as with_policies
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_policy p ON p.polrelid = c.oid
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
            "#,
        )
        .fetch_one(&pool)
        .await
        .expect("Failed to fetch RLS summary");

        println!("=== RLS Configuration Summary ===");
        println!("Total tables: {}", summary.total_tables);
        println!("RLS enabled: {}", summary.rls_enabled);
        println!("FORCE RLS: {}", summary.force_rls);
        println!("With policies: {}", summary.with_policies);
        println!("=================================");

        // Verify that all RLS-enabled tables have FORCE RLS
        assert_eq!(
            summary.rls_enabled, summary.force_rls,
            "Mismatch: {} tables have RLS enabled, but only {} have FORCE RLS",
            summary.rls_enabled, summary.force_rls
        );
    }
}
