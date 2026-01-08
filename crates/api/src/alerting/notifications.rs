//! Alert notification delivery
//!
//! Sends security alerts via Slack webhooks

use serde_json::json;

use super::{SecurityAlert, Severity};

/// Slack webhook notifier
#[derive(Clone)]
pub struct SlackNotifier {
    webhook_url: Option<String>,
}

impl SlackNotifier {
    /// Create a new Slack notifier
    pub fn new(webhook_url: Option<String>) -> Self {
        Self { webhook_url }
    }

    /// Send alert to Slack
    pub async fn send_alert(
        &self,
        alert: &SecurityAlert,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let Some(ref webhook_url) = self.webhook_url else {
            tracing::warn!("Slack webhook URL not configured, skipping notification");
            return Ok(());
        };

        let emoji = match alert.severity {
            Severity::Critical => ":rotating_light:",
            Severity::High => ":warning:",
            Severity::Medium => ":large_orange_diamond:",
            Severity::Low => ":information_source:",
        };

        let color = match alert.severity {
            Severity::Critical => "#FF0000", // Red
            Severity::High => "#FFA500",     // Orange
            Severity::Medium => "#FFFF00",   // Yellow
            Severity::Low => "#00BFFF",      // Blue
        };

        // Build Slack message with attachment
        let payload = json!({
            "text": format!("{} *Security Alert: {}*", emoji, alert.title),
            "attachments": [{
                "color": color,
                "fields": [
                    {
                        "title": "Severity",
                        "value": format!("{:?}", alert.severity),
                        "short": true
                    },
                    {
                        "title": "Type",
                        "value": format!("{:?}", alert.alert_type),
                        "short": true
                    },
                    {
                        "title": "Description",
                        "value": alert.description,
                        "short": false
                    },
                    {
                        "title": "Event Count",
                        "value": alert.event_count.to_string(),
                        "short": true
                    },
                    {
                        "title": "Alert ID",
                        "value": alert.id.to_string(),
                        "short": true
                    }
                ],
                "footer": "PlexMCP Security Monitoring",
                "ts": alert.created_at.unix_timestamp()
            }]
        });

        // Send to Slack
        let client = reqwest::Client::new();
        let response = client.post(webhook_url).json(&payload).send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            tracing::error!(
                status = %status,
                body = %body,
                "Failed to send Slack notification"
            );
            return Err(format!("Slack webhook returned {}: {}", status, body).into());
        }

        tracing::info!(alert_id = %alert.id, "Successfully sent alert to Slack");
        Ok(())
    }
}
