//! Alert trigger helpers
//!
//! Common functions for triggering security alerts

use serde_json::json;
use uuid::Uuid;

use super::{AlertService, AlertType};
use crate::error::ApiResult;

/// Trigger brute force attack alert
pub async fn trigger_brute_force_alert(
    alert_service: &AlertService,
    user_id: Option<Uuid>,
    email: &str,
    ip_address: Option<&str>,
) -> ApiResult<Option<Uuid>> {
    let threshold_key = if let Some(ref ip) = ip_address {
        format!("ip:{}", ip)
    } else {
        format!("user:{}", email)
    };

    alert_service
        .record_event(
            AlertType::BruteForceAttack,
            &threshold_key,
            user_id,
            None,
            ip_address,
            json!({
                "email": email,
                "ip_address": ip_address,
                "attack_vector": "failed_login"
            }),
        )
        .await
}

/// Trigger privilege escalation alert
pub async fn trigger_privilege_escalation_alert(
    alert_service: &AlertService,
    target_user_id: Uuid,
    target_email: &str,
    old_role: &str,
    new_role: &str,
    changed_by: Uuid,
    org_id: Uuid,
) -> ApiResult<Option<Uuid>> {
    // Only alert if elevated to admin or superadmin
    if !["admin", "superadmin", "owner"].contains(&new_role) {
        return Ok(None);
    }

    alert_service
        .record_event(
            AlertType::PrivilegeEscalation,
            &format!("user:{}", target_user_id),
            Some(target_user_id),
            Some(org_id),
            None,
            json!({
                "target_user_id": target_user_id,
                "target_email": target_email,
                "old_role": old_role,
                "new_role": new_role,
                "changed_by": changed_by,
                "org_id": org_id
            }),
        )
        .await
}

/// Trigger data exfiltration alert
pub async fn trigger_data_exfiltration_alert(
    alert_service: &AlertService,
    user_id: Uuid,
    org_id: Uuid,
    resource_type: &str,
    record_count: i64,
    ip_address: Option<&str>,
) -> ApiResult<Option<Uuid>> {
    alert_service
        .record_event(
            AlertType::DataExfiltration,
            &format!("user:{}:export", user_id),
            Some(user_id),
            Some(org_id),
            ip_address,
            json!({
                "resource_type": resource_type,
                "record_count": record_count,
                "export_type": "bulk_export"
            }),
        )
        .await
}

/// Trigger configuration change alert
pub async fn trigger_configuration_change_alert(
    alert_service: &AlertService,
    user_id: Uuid,
    org_id: Uuid,
    config_type: &str,
    change_details: serde_json::Value,
    ip_address: Option<&str>,
) -> ApiResult<Option<Uuid>> {
    alert_service
        .record_event(
            AlertType::ConfigurationChange,
            &format!("config:{}", config_type),
            Some(user_id),
            Some(org_id),
            ip_address,
            json!({
                "config_type": config_type,
                "change_details": change_details
            }),
        )
        .await
}

/// Trigger rate limit violation alert
pub async fn trigger_rate_limit_alert(
    alert_service: &AlertService,
    user_id: Option<Uuid>,
    org_id: Option<Uuid>,
    endpoint: &str,
    ip_address: Option<&str>,
) -> ApiResult<Option<Uuid>> {
    let threshold_key = if let Some(ref ip) = ip_address {
        format!("ip:{}:ratelimit", ip)
    } else if let Some(uid) = user_id {
        format!("user:{}:ratelimit", uid)
    } else {
        "unknown:ratelimit".to_string()
    };

    alert_service
        .record_event(
            AlertType::RateLimitViolation,
            &threshold_key,
            user_id,
            org_id,
            ip_address,
            json!({
                "endpoint": endpoint,
                "violation_type": "rate_limit_exceeded"
            }),
        )
        .await
}

/// Trigger suspicious activity alert
pub async fn trigger_suspicious_activity_alert(
    alert_service: &AlertService,
    user_id: Option<Uuid>,
    org_id: Option<Uuid>,
    activity_type: &str,
    details: serde_json::Value,
    ip_address: Option<&str>,
) -> ApiResult<Option<Uuid>> {
    let threshold_key = if let Some(uid) = user_id {
        format!("user:{}:suspicious", uid)
    } else if let Some(ref ip) = ip_address {
        format!("ip:{}:suspicious", ip)
    } else {
        "unknown:suspicious".to_string()
    };

    alert_service
        .record_event(
            AlertType::SuspiciousActivity,
            &threshold_key,
            user_id,
            org_id,
            ip_address,
            json!({
                "activity_type": activity_type,
                "details": details
            }),
        )
        .await
}

/// Trigger authentication anomaly alert
pub async fn trigger_auth_anomaly_alert(
    alert_service: &AlertService,
    user_id: Uuid,
    email: &str,
    anomaly_type: &str,
    details: serde_json::Value,
    ip_address: Option<&str>,
) -> ApiResult<Option<Uuid>> {
    alert_service
        .record_event(
            AlertType::AuthenticationAnomaly,
            &format!("user:{}:auth_anomaly", user_id),
            Some(user_id),
            None,
            ip_address,
            json!({
                "email": email,
                "anomaly_type": anomaly_type,
                "details": details
            }),
        )
        .await
}
