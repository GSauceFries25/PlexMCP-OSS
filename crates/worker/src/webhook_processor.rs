///! Webhook Queue Processor
///!
///! Processes webhooks from the persistent queue with retry logic.
///! This replaces the fire-and-forget pattern with reliable processing.

use sqlx::PgPool;
use uuid::Uuid;
use serde_json::Value;
use tracing::{error, info, warn};
use std::time::Duration;

/// Process pending webhooks from the queue
pub async fn process_webhook_queue(
    pool: &PgPool,
    http_client: &reqwest::Client,
    resend_api_key: &str,
    enable_email_routing: bool,
) {
    // Find webhooks to process (pending or failed with retries remaining)
    let webhooks: Vec<(Uuid, String, Value, i32, i32)> = match sqlx::query_as(
        r#"
        SELECT id, webhook_type, payload, attempts, max_attempts
        FROM webhook_processing_queue
        WHERE (status = 'pending' OR (status = 'failed' AND attempts < max_attempts))
          AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - INTERVAL '5 minutes')
        ORDER BY created_at ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
        "#
    )
    .fetch_all(pool)
    .await
    {
        Ok(w) => w,
        Err(e) => {
            error!(error = %e, "Failed to fetch webhooks from queue");
            return;
        }
    };

    if webhooks.is_empty() {
        return; // No work to do
    }

    info!(count = webhooks.len(), "Processing webhooks from queue");

    for (queue_id, webhook_type, payload, attempts, max_attempts) in webhooks {
        // Mark as processing
        if let Err(e) = sqlx::query(
            r#"
            UPDATE webhook_processing_queue
            SET status = 'processing', last_attempt_at = NOW(), attempts = attempts + 1
            WHERE id = $1
            "#
        )
        .bind(queue_id)
        .execute(pool)
        .await
        {
            error!(queue_id = %queue_id, error = %e, "Failed to mark webhook as processing");
            continue;
        }

        // Process based on webhook type
        let result = match webhook_type.as_str() {
            "email.received" => {
                process_email_webhook(pool, http_client, resend_api_key, enable_email_routing, &payload).await
            }
            _ => {
                warn!(webhook_type = %webhook_type, "Unknown webhook type");
                Ok(()) // Don't retry unknown types
            }
        };

        // Update queue status based on result
        match result {
            Ok(_) => {
                // Success - mark as completed
                if let Err(e) = sqlx::query(
                    "UPDATE webhook_processing_queue SET status = 'completed', processed_at = NOW() WHERE id = $1"
                )
                .bind(queue_id)
                .execute(pool)
                .await
                {
                    error!(queue_id = %queue_id, error = %e, "Failed to mark webhook as completed");
                }
                info!(queue_id = %queue_id, webhook_type = %webhook_type, "Webhook processed successfully");
            }
            Err(e) => {
                let error_msg = e.to_string();
                let new_attempts = attempts + 1;

                // Determine if this is a permanent failure
                let status = if new_attempts >= max_attempts {
                    "failed" // Permanent failure
                } else {
                    "failed" // Will retry
                };

                if let Err(e) = sqlx::query(
                    "UPDATE webhook_processing_queue SET status = $1, last_error = $2 WHERE id = $3"
                )
                .bind(status)
                .bind(&error_msg)
                .bind(queue_id)
                .execute(pool)
                .await
                {
                    error!(queue_id = %queue_id, error = %e, "Failed to mark webhook as failed");
                }

                if new_attempts >= max_attempts {
                    error!(
                        queue_id = %queue_id,
                        webhook_type = %webhook_type,
                        attempts = new_attempts,
                        error = %error_msg,
                        "Webhook permanently failed after max retries"
                    );
                } else {
                    warn!(
                        queue_id = %queue_id,
                        webhook_type = %webhook_type,
                        attempts = new_attempts,
                        max_attempts = max_attempts,
                        error = %error_msg,
                        "Webhook processing failed, will retry"
                    );
                }
            }
        }
    }
}

/// Process an email webhook from the queue
/// NOTE: Email webhook processing is disabled in the source-available release.
/// This function is a stub that logs a warning and returns success.
async fn process_email_webhook(
    _pool: &PgPool,
    _http_client: &reqwest::Client,
    _resend_api_key: &str,
    _enable_email_routing: bool,
    _payload: &Value,
) -> anyhow::Result<()> {
    warn!("Email webhook processing is disabled in source-available release");
    Ok(())
}

/// Cleanup old completed/failed webhooks (for maintenance job)
pub async fn cleanup_old_webhooks(pool: &PgPool, retention_days: i32) {
    let result = sqlx::query(
        r#"
        DELETE FROM webhook_processing_queue
        WHERE processed_at < NOW() - ($1 || ' days')::INTERVAL
          AND status IN ('completed', 'failed')
        "#
    )
    .bind(retention_days)
    .execute(pool)
    .await;

    match result {
        Ok(rows) => {
            if rows.rows_affected() > 0 {
                info!(
                    deleted = rows.rows_affected(),
                    retention_days = retention_days,
                    "Cleaned up old webhook queue entries"
                );
            }
        }
        Err(e) => {
            error!(error = %e, "Failed to cleanup old webhooks");
        }
    }
}
