//! Security Alerting System
//!
//! Automated monitoring and alerting for security events:
//! - Brute force attacks
//! - Privilege escalation
//! - Data exfiltration
//! - Configuration changes
//! - Rate limit violations
//!
//! SOC 2 Requirement: CC7.2 - System monitoring

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::ApiResult;

mod notifications;
mod triggers;

pub use notifications::SlackNotifier;
pub use triggers::*;

/// Alert type classification
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AlertType {
    BruteForceAttack,
    PrivilegeEscalation,
    DataExfiltration,
    ConfigurationChange,
    RateLimitViolation,
    SuspiciousActivity,
    AuthenticationAnomaly,
}

impl AlertType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::BruteForceAttack => "brute_force_attack",
            Self::PrivilegeEscalation => "privilege_escalation",
            Self::DataExfiltration => "data_exfiltration",
            Self::ConfigurationChange => "configuration_change",
            Self::RateLimitViolation => "rate_limit_violation",
            Self::SuspiciousActivity => "suspicious_activity",
            Self::AuthenticationAnomaly => "authentication_anomaly",
        }
    }
}

/// Alert severity level
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

impl Severity {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Critical => "critical",
        }
    }
}

/// Security alert
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityAlert {
    pub id: Uuid,
    pub alert_type: AlertType,
    pub severity: Severity,
    pub user_id: Option<Uuid>,
    pub org_id: Option<Uuid>,
    pub ip_address: Option<String>,
    pub title: String,
    pub description: String,
    pub metadata: serde_json::Value,
    pub event_count: i32,
    pub first_seen_at: OffsetDateTime,
    pub last_seen_at: OffsetDateTime,
    pub created_at: OffsetDateTime,
}

/// Alert service for managing security alerts
#[derive(Clone)]
pub struct AlertService {
    pool: PgPool,
    notifier: SlackNotifier,
}

impl AlertService {
    /// Create a new alert service
    pub fn new(pool: PgPool, slack_webhook_url: Option<String>) -> Self {
        Self {
            pool,
            notifier: SlackNotifier::new(slack_webhook_url),
        }
    }

    /// Record a security event and check if alert should be triggered
    pub async fn record_event(
        &self,
        alert_type: AlertType,
        threshold_key: &str,
        user_id: Option<Uuid>,
        org_id: Option<Uuid>,
        ip_address: Option<&str>,
        metadata: serde_json::Value,
    ) -> ApiResult<Option<Uuid>> {
        // Get alert configuration
        let config: Option<(i32, i32)> = sqlx::query_as(
            r#"
            SELECT threshold_count, threshold_window_seconds
            FROM alert_configurations
            WHERE alert_type = $1 AND enabled = true
            "#,
        )
        .bind(alert_type.as_str())
        .fetch_optional(&self.pool)
        .await?;

        let Some((threshold_count, window_seconds)) = config else {
            // Alert type not configured or disabled
            return Ok(None);
        };

        // Increment threshold and check if alert should be triggered
        let should_trigger: bool =
            sqlx::query_scalar("SELECT increment_alert_threshold($1, $2, $3)")
                .bind(alert_type.as_str())
                .bind(threshold_key)
                .bind(window_seconds)
                .fetch_one(&self.pool)
                .await?;

        if !should_trigger {
            return Ok(None);
        }

        // Determine severity based on alert type
        let severity = match alert_type {
            AlertType::PrivilegeEscalation => Severity::Critical,
            AlertType::ConfigurationChange => Severity::Critical,
            AlertType::BruteForceAttack => Severity::High,
            AlertType::DataExfiltration => Severity::High,
            AlertType::RateLimitViolation => Severity::Medium,
            AlertType::SuspiciousActivity => Severity::Medium,
            AlertType::AuthenticationAnomaly => Severity::Low,
        };

        // Create alert
        let alert_id = self
            .create_alert(
                alert_type,
                severity,
                user_id,
                org_id,
                ip_address,
                threshold_count,
                metadata,
            )
            .await?;

        // Send notification (fire and forget)
        let alert_for_notification = self.get_alert(alert_id).await?;
        if let Some(alert) = alert_for_notification {
            let notifier = self.notifier.clone();
            tokio::spawn(async move {
                if let Err(e) = notifier.send_alert(&alert).await {
                    tracing::error!(alert_id = %alert.id, error = ?e, "Failed to send alert notification");
                }
            });
        }

        Ok(Some(alert_id))
    }

    /// Create a security alert
    #[allow(clippy::too_many_arguments)]
    async fn create_alert(
        &self,
        alert_type: AlertType,
        severity: Severity,
        user_id: Option<Uuid>,
        org_id: Option<Uuid>,
        ip_address: Option<&str>,
        event_count: i32,
        metadata: serde_json::Value,
    ) -> ApiResult<Uuid> {
        let (title, description) = self.generate_alert_message(alert_type, event_count, &metadata);

        let alert_id: Uuid = sqlx::query_scalar(
            r#"
            INSERT INTO security_alerts (
                alert_type, severity, user_id, org_id, ip_address,
                title, description, metadata, event_count,
                notification_status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
            RETURNING id
            "#,
        )
        .bind(alert_type.as_str())
        .bind(severity.as_str())
        .bind(user_id)
        .bind(org_id)
        .bind(ip_address)
        .bind(title)
        .bind(description)
        .bind(metadata)
        .bind(event_count)
        .fetch_one(&self.pool)
        .await?;

        Ok(alert_id)
    }

    /// Get alert by ID
    async fn get_alert(&self, alert_id: Uuid) -> ApiResult<Option<SecurityAlert>> {
        #[derive(sqlx::FromRow)]
        struct AlertRow {
            id: Uuid,
            alert_type: String,
            severity: String,
            user_id: Option<Uuid>,
            org_id: Option<Uuid>,
            ip_address: Option<String>,
            title: String,
            description: String,
            metadata: serde_json::Value,
            event_count: i32,
            first_seen_at: OffsetDateTime,
            last_seen_at: OffsetDateTime,
            created_at: OffsetDateTime,
        }

        let row: Option<AlertRow> = sqlx::query_as(
            r#"
            SELECT
                id, alert_type, severity, user_id, org_id, ip_address,
                title, description, metadata, event_count,
                first_seen_at, last_seen_at, created_at
            FROM security_alerts
            WHERE id = $1
            "#,
        )
        .bind(alert_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| SecurityAlert {
            id: r.id,
            alert_type: parse_alert_type(&r.alert_type),
            severity: parse_severity(&r.severity),
            user_id: r.user_id,
            org_id: r.org_id,
            ip_address: r.ip_address,
            title: r.title,
            description: r.description,
            metadata: r.metadata,
            event_count: r.event_count,
            first_seen_at: r.first_seen_at,
            last_seen_at: r.last_seen_at,
            created_at: r.created_at,
        }))
    }

    /// Generate alert title and description
    fn generate_alert_message(
        &self,
        alert_type: AlertType,
        event_count: i32,
        metadata: &serde_json::Value,
    ) -> (String, String) {
        match alert_type {
            AlertType::BruteForceAttack => (
                format!("Brute Force Attack Detected ({} attempts)", event_count),
                format!(
                    "{} failed login attempts detected from same source. \
                     This may indicate a credential stuffing or brute force attack. \
                     IP address and user account have been flagged.",
                    event_count
                ),
            ),
            AlertType::PrivilegeEscalation => (
                "Privilege Escalation Detected".to_string(),
                format!(
                    "User role was changed to admin or superadmin. \
                     Review this action immediately. Details: {}",
                    serde_json::to_string_pretty(metadata).unwrap_or_default()
                ),
            ),
            AlertType::DataExfiltration => (
                format!("Potential Data Exfiltration ({} events)", event_count),
                format!(
                    "{} large data export operations detected in rapid succession. \
                     This may indicate unauthorized data extraction. Review immediately.",
                    event_count
                ),
            ),
            AlertType::ConfigurationChange => (
                "Critical Configuration Change".to_string(),
                format!(
                    "Critical system configuration was modified. \
                     Review change log: {}",
                    serde_json::to_string_pretty(metadata).unwrap_or_default()
                ),
            ),
            AlertType::RateLimitViolation => (
                format!("Rate Limit Violations ({} events)", event_count),
                format!(
                    "{} rate limit violations detected. This may indicate API abuse or DDoS attempt.",
                    event_count
                ),
            ),
            AlertType::SuspiciousActivity => (
                format!("Suspicious Activity Detected ({} events)", event_count),
                format!(
                    "{} suspicious security events detected. Review activity logs for details.",
                    event_count
                ),
            ),
            AlertType::AuthenticationAnomaly => (
                "Authentication Anomaly Detected".to_string(),
                format!(
                    "Unusual authentication pattern detected. Details: {}",
                    serde_json::to_string_pretty(metadata).unwrap_or_default()
                ),
            ),
        }
    }

    /// Mark alert as notified
    pub async fn mark_notified(
        &self,
        alert_id: Uuid,
        success: bool,
        error: Option<&str>,
    ) -> ApiResult<()> {
        let status = if success { "sent" } else { "failed" };

        sqlx::query(
            r#"
            UPDATE security_alerts
            SET notified_at = NOW(),
                notification_status = $2,
                notification_error = $3
            WHERE id = $1
            "#,
        )
        .bind(alert_id)
        .bind(status)
        .bind(error)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}

fn parse_alert_type(s: &str) -> AlertType {
    match s {
        "brute_force_attack" => AlertType::BruteForceAttack,
        "privilege_escalation" => AlertType::PrivilegeEscalation,
        "data_exfiltration" => AlertType::DataExfiltration,
        "configuration_change" => AlertType::ConfigurationChange,
        "rate_limit_violation" => AlertType::RateLimitViolation,
        "suspicious_activity" => AlertType::SuspiciousActivity,
        "authentication_anomaly" => AlertType::AuthenticationAnomaly,
        _ => AlertType::SuspiciousActivity,
    }
}

fn parse_severity(s: &str) -> Severity {
    match s {
        "low" => Severity::Low,
        "medium" => Severity::Medium,
        "high" => Severity::High,
        "critical" => Severity::Critical,
        _ => Severity::Medium,
    }
}
