//! Email notifications for billing events
//!
//! Sends transactional emails via Resend API for billing-related events.

use crate::error::BillingResult;

/// Email configuration
#[derive(Debug, Clone)]
pub struct EmailConfig {
    /// Resend API key
    pub resend_api_key: String,
    /// From address for emails
    pub email_from: String,
    /// App name for branding
    pub app_name: String,
    /// Support email
    pub support_email: String,
    /// Dashboard URL
    pub dashboard_url: String,
}

impl EmailConfig {
    /// Create config from environment variables
    pub fn from_env() -> Self {
        Self {
            resend_api_key: std::env::var("RESEND_API_KEY").unwrap_or_default(),
            email_from: std::env::var("EMAIL_FROM")
                .unwrap_or_else(|_| "PlexMCP <noreply@plexmcp.com>".to_string()),
            app_name: std::env::var("APP_NAME").unwrap_or_else(|_| "PlexMCP".to_string()),
            support_email: std::env::var("SUPPORT_EMAIL")
                .unwrap_or_else(|_| "support@plexmcp.com".to_string()),
            dashboard_url: std::env::var("PUBLIC_URL")
                .unwrap_or_else(|_| "https://plexmcp.com".to_string()),
        }
    }

    /// Check if email sending is enabled
    pub fn is_enabled(&self) -> bool {
        !self.resend_api_key.is_empty()
    }
}

/// Billing email notification service
#[derive(Clone)]
pub struct BillingEmailService {
    config: EmailConfig,
    client: reqwest::Client,
}

impl BillingEmailService {
    /// Create a new email service
    pub fn new(config: EmailConfig) -> Self {
        Self {
            config,
            client: reqwest::Client::new(),
        }
    }

    /// Create from environment variables
    pub fn from_env() -> Self {
        Self::new(EmailConfig::from_env())
    }

    /// Send an email via Resend API
    ///
    /// Returns `Ok(true)` if the email was sent successfully,
    /// `Ok(false)` if sending failed (non-fatal - doesn't propagate error),
    /// `Err` only for critical configuration issues.
    ///
    /// The `Ok(false)` return allows callers to track email delivery status
    /// while not failing webhook processing due to email errors.
    async fn send_email(&self, to: &str, subject: &str, html: &str) -> BillingResult<bool> {
        if !self.config.is_enabled() {
            tracing::warn!(
                to = %to,
                subject = %subject,
                "Email not configured, skipping"
            );
            return Ok(false);
        }

        #[allow(clippy::disallowed_methods)]
        // json! macro uses unwrap internally, safe for primitive types
        let body = serde_json::json!({
            "from": self.config.email_from,
            "to": [to],
            "subject": subject,
            "html": html
        });

        let response = self
            .client
            .post("https://api.resend.com/emails")
            .header(
                "Authorization",
                format!("Bearer {}", self.config.resend_api_key),
            )
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await;

        match response {
            Ok(resp) if resp.status().is_success() => {
                tracing::info!(to = %to, subject = %subject, "Billing email sent");
                Ok(true)
            }
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::error!(
                    to = %to,
                    subject = %subject,
                    status = %status,
                    body = %body,
                    "Failed to send billing email - non-fatal"
                );
                Ok(false) // Don't fail webhooks due to email errors
            }
            Err(e) => {
                tracing::error!(
                    to = %to,
                    subject = %subject,
                    error = %e,
                    "Failed to send billing email - non-fatal"
                );
                Ok(false) // Don't fail webhooks due to email errors
            }
        }
    }

    /// Send payment failed notification (with optional invoice URL)
    pub async fn send_payment_failed_invoice(
        &self,
        to: &str,
        org_name: &str,
        amount_cents: i64,
        invoice_url: Option<&str>,
    ) -> BillingResult<bool> {
        let amount = format!("${:.2}", amount_cents as f64 / 100.0);
        let update_link = format!("{}/billing", self.config.dashboard_url);
        let invoice_section = invoice_url
            .map(|url| {
                format!(
                    r#"<p><a href="{}" style="color: #6366f1;">View Invoice</a></p>"#,
                    url
                )
            })
            .unwrap_or_default();

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #dc2626;">Payment Failed</h2>
    <p>Hi there,</p>
    <p>We weren't able to process the payment of <strong>{amount}</strong> for <strong>{org_name}</strong>.</p>
    <p>Please update your payment method to avoid any interruption to your service.</p>
    <p>
        <a href="{update_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Update Payment Method
        </a>
    </p>
    {invoice_section}
    <p style="color: #666; font-size: 14px;">
        If you have any questions, please contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            amount = amount,
            org_name = org_name,
            update_link = update_link,
            invoice_section = invoice_section,
            support_email = self.config.support_email,
            app_name = self.config.app_name,
        );

        self.send_email(
            to,
            &format!("Payment Failed - {}", self.config.app_name),
            &html,
        )
        .await
    }

    /// Send payment failed notification (with error message from Stripe)
    pub async fn send_payment_failed(
        &self,
        to: &str,
        org_name: &str,
        amount_cents: i32,
        error_message: &str,
    ) -> BillingResult<bool> {
        let amount = format!("${:.2}", amount_cents as f64 / 100.0);
        let update_link = format!("{}/billing", self.config.dashboard_url);

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #dc2626;">Payment Failed</h2>
    <p>Hi there,</p>
    <p>We weren't able to process the payment of <strong>{amount}</strong> for <strong>{org_name}</strong>.</p>
    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0; color: #dc2626;"><strong>Reason:</strong> {error_message}</p>
    </div>
    <p>Please update your payment method to avoid any interruption to your service.</p>
    <p>
        <a href="{update_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Update Payment Method
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        If you have any questions, please contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            amount = amount,
            org_name = org_name,
            error_message = error_message,
            update_link = update_link,
            support_email = self.config.support_email,
            app_name = self.config.app_name,
        );

        self.send_email(
            to,
            &format!("Payment Failed - {}", self.config.app_name),
            &html,
        )
        .await
    }

    /// Send upcoming invoice notification (sent ~3 days before billing)
    pub async fn send_upcoming_invoice(
        &self,
        to: &str,
        org_name: &str,
        subscription_amount_cents: i32,
        overage_amount_cents: i32,
    ) -> BillingResult<bool> {
        let subscription_amount = format!("${:.2}", subscription_amount_cents as f64 / 100.0);
        let overage_amount = format!("${:.2}", overage_amount_cents as f64 / 100.0);
        let total_cents = subscription_amount_cents + overage_amount_cents;
        let total_amount = format!("${:.2}", total_cents as f64 / 100.0);
        let billing_link = format!("{}/billing", self.config.dashboard_url);

        let overage_section = if overage_amount_cents > 0 {
            format!(
                r#"<tr style="color: #dc2626;">
                    <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">Pending Overages</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">{}</td>
                </tr>"#,
                overage_amount
            )
        } else {
            String::new()
        };

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #2563eb;">Upcoming Invoice</h2>
    <p>Hi there,</p>
    <p>Your next invoice for <strong>{org_name}</strong> will be processed soon.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
            <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">Subscription</td>
            <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">{subscription_amount}</td>
        </tr>
        {overage_section}
        <tr style="font-weight: bold;">
            <td style="padding: 10px 0;">Total</td>
            <td style="padding: 10px 0; text-align: right;">{total_amount}</td>
        </tr>
    </table>
    <p>Please ensure your payment method is up to date to avoid service interruption.</p>
    <a href="{billing_link}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0;">Review Billing</a>
    <p style="font-size: 14px; color: #666; margin-top: 30px;">
        Questions? Contact <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <p style="font-size: 12px; color: #999;">— The {app_name} Team</p>
</body>
</html>"#,
            org_name = org_name,
            subscription_amount = subscription_amount,
            overage_section = overage_section,
            total_amount = total_amount,
            billing_link = billing_link,
            support_email = self.config.support_email,
            app_name = self.config.app_name,
        );

        self.send_email(
            to,
            &format!("Upcoming Invoice - {}", self.config.app_name),
            &html,
        )
        .await
    }

    /// Send dispute alert notification (CRITICAL - chargebacks are serious)
    pub async fn send_dispute_alert(
        &self,
        to: &str,
        org_name: &str,
        amount_cents: i32,
        reason: &str,
    ) -> BillingResult<bool> {
        let amount = format!("${:.2}", amount_cents as f64 / 100.0);
        let billing_link = format!("{}/billing", self.config.dashboard_url);

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #dc2626;">Payment Dispute Alert</h2>
    <p>Hi there,</p>
    <p>A payment dispute (chargeback) has been filed for <strong>{org_name}</strong>.</p>
    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0 0 8px 0; color: #dc2626;"><strong>Status:</strong> Dispute Opened</p>
        <p style="margin: 0 0 8px 0;"><strong>Amount:</strong> {amount}</p>
        <p style="margin: 0;"><strong>Reason:</strong> {reason}</p>
    </div>
    <p><strong>Important:</strong> Disputes can result in service interruption and fees. Please contact our support team immediately if you have questions about this charge.</p>
    <p>If this dispute was filed by mistake, please contact your bank to withdraw it.</p>
    <p>
        <a href="{billing_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            View Billing Details
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        Questions? Contact us immediately at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            amount = amount,
            org_name = org_name,
            reason = reason,
            billing_link = billing_link,
            support_email = self.config.support_email,
            app_name = self.config.app_name,
        );

        self.send_email(
            to,
            &format!("URGENT: Payment Dispute Filed - {}", self.config.app_name),
            &html,
        )
        .await
    }

    /// Send trial ending notification
    pub async fn send_trial_ending(
        &self,
        to: &str,
        org_name: &str,
        days_remaining: i64,
        tier: &str,
    ) -> BillingResult<bool> {
        let billing_link = format!("{}/billing", self.config.dashboard_url);

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #f59e0b;">Your Trial is Ending Soon</h2>
    <p>Hi there,</p>
    <p>Your <strong>{tier}</strong> trial for <strong>{org_name}</strong> will end in <strong>{days_remaining} day{s}</strong>.</p>
    <p>To continue using all features without interruption, please add a payment method.</p>
    <p>
        <a href="{billing_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Manage Subscription
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        Questions? Contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            tier = tier,
            org_name = org_name,
            days_remaining = days_remaining,
            s = if days_remaining == 1 { "" } else { "s" },
            billing_link = billing_link,
            support_email = self.config.support_email,
            app_name = self.config.app_name,
        );

        self.send_email(
            to,
            &format!(
                "Trial Ending in {} Days - {}",
                days_remaining, self.config.app_name
            ),
            &html,
        )
        .await
    }

    /// Send subscription past due notification
    pub async fn send_subscription_past_due(
        &self,
        to: &str,
        org_name: &str,
    ) -> BillingResult<bool> {
        let billing_link = format!("{}/billing", self.config.dashboard_url);

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #dc2626;">Subscription Past Due</h2>
    <p>Hi there,</p>
    <p>Your subscription for <strong>{org_name}</strong> is past due.</p>
    <p>Please update your payment method to avoid service interruption. Your account may be downgraded if payment is not received soon.</p>
    <p>
        <a href="{billing_link}" style="display: inline-block; padding: 12px 24px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Update Payment Now
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        Need help? Contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            org_name = org_name,
            billing_link = billing_link,
            support_email = self.config.support_email,
            app_name = self.config.app_name,
        );

        self.send_email(
            to,
            &format!(
                "Action Required: Subscription Past Due - {}",
                self.config.app_name
            ),
            &html,
        )
        .await
    }

    /// Send subscription cancelled confirmation
    pub async fn send_subscription_cancelled(
        &self,
        to: &str,
        org_name: &str,
        end_date: &str,
    ) -> BillingResult<bool> {
        let resubscribe_link = format!("{}/billing", self.config.dashboard_url);

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #333;">Subscription Cancelled</h2>
    <p>Hi there,</p>
    <p>Your subscription for <strong>{org_name}</strong> has been cancelled.</p>
    <p>You'll continue to have access to your current plan features until <strong>{end_date}</strong>. After that, your account will be downgraded to the Free tier.</p>
    <p>Changed your mind? You can resubscribe anytime.</p>
    <p>
        <a href="{resubscribe_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Resubscribe
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        Questions? Contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            org_name = org_name,
            end_date = end_date,
            resubscribe_link = resubscribe_link,
            support_email = self.config.support_email,
            app_name = self.config.app_name,
        );

        self.send_email(
            to,
            &format!("Subscription Cancelled - {}", self.config.app_name),
            &html,
        )
        .await
    }

    /// Send subscription downgraded notification
    pub async fn send_subscription_downgraded(
        &self,
        to: &str,
        org_name: &str,
        new_tier: &str,
    ) -> BillingResult<bool> {
        let billing_link = format!("{}/billing", self.config.dashboard_url);
        let tier_display = match new_tier {
            "free" => "Free",
            "pro" => "Pro",
            "team" => "Team",
            "enterprise" => "Enterprise",
            _ => new_tier,
        };

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #6366f1;">Subscription Plan Changed</h2>
    <p>Hi there,</p>
    <p>Your subscription for <strong>{org_name}</strong> has been updated to the <strong>{tier_display}</strong> plan.</p>
    <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0; color: #0369a1;"><strong>New Plan:</strong> {tier_display}</p>
    </div>
    <p>Your new plan limits are now in effect. You can view your plan details and upgrade at any time.</p>
    <p>
        <a href="{billing_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            View Plan Details
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        Questions? Contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            org_name = org_name,
            tier_display = tier_display,
            billing_link = billing_link,
            support_email = self.config.support_email,
            app_name = self.config.app_name,
        );

        self.send_email(
            to,
            &format!(
                "Plan Changed to {} - {}",
                tier_display, self.config.app_name
            ),
            &html,
        )
        .await
    }

    /// Send spend cap threshold notification (50%, 75%, 90%, 100%)
    pub async fn send_spend_cap_threshold(
        &self,
        to: &str,
        org_name: &str,
        threshold: i32,
        current_spend_cents: i32,
        cap_amount_cents: i32,
    ) -> BillingResult<bool> {
        let billing_link = format!("{}/billing", self.config.dashboard_url);
        let current_spend = format!("${:.2}", current_spend_cents as f64 / 100.0);
        let cap_amount = format!("${:.2}", cap_amount_cents as f64 / 100.0);

        let (header_color, urgency) = match threshold {
            100 => ("#dc2626", "Your spend cap has been reached"),
            90 => ("#ea580c", "You're approaching your spend cap"),
            75 => ("#f59e0b", "You've used 75% of your spend cap"),
            _ => ("#6366f1", "Spend cap update"),
        };

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: {header_color};">{threshold}% of Spend Cap Reached</h2>
    <p>Hi there,</p>
    <p>{urgency} for <strong>{org_name}</strong>.</p>
    <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0 0 8px 0;"><strong>Current Spend:</strong> {current_spend}</p>
        <p style="margin: 0 0 8px 0;"><strong>Spend Cap:</strong> {cap_amount}</p>
        <p style="margin: 0;"><strong>Usage:</strong> {threshold}%</p>
    </div>
    <p>You can adjust your spend cap or upgrade your plan to increase your limits.</p>
    <p>
        <a href="{billing_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Manage Spend Cap
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        Questions? Contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            header_color = header_color,
            threshold = threshold,
            urgency = urgency,
            org_name = org_name,
            current_spend = current_spend,
            cap_amount = cap_amount,
            billing_link = billing_link,
            support_email = self.config.support_email,
            app_name = self.config.app_name,
        );

        self.send_email(
            to,
            &format!("{}% Spend Cap Alert - {}", threshold, self.config.app_name),
            &html,
        )
        .await
    }

    /// Send API paused notification (spend cap with hard pause enabled)
    pub async fn send_api_paused(
        &self,
        to: &str,
        org_name: &str,
        current_spend_cents: i32,
        cap_amount_cents: i32,
    ) -> BillingResult<bool> {
        let billing_link = format!("{}/billing", self.config.dashboard_url);
        let current_spend = format!("${:.2}", current_spend_cents as f64 / 100.0);
        let cap_amount = format!("${:.2}", cap_amount_cents as f64 / 100.0);

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #dc2626;">API Access Paused</h2>
    <p>Hi there,</p>
    <p>API access for <strong>{org_name}</strong> has been paused because your spend cap has been reached.</p>
    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0 0 8px 0; color: #dc2626;"><strong>Status:</strong> API Paused</p>
        <p style="margin: 0 0 8px 0;"><strong>Current Spend:</strong> {current_spend}</p>
        <p style="margin: 0;"><strong>Spend Cap:</strong> {cap_amount}</p>
    </div>
    <p>To resume API access, you can:</p>
    <ul>
        <li>Increase your spend cap</li>
        <li>Disable hard pause to allow overages</li>
        <li>Pay outstanding overages now</li>
        <li>Upgrade to a higher plan</li>
    </ul>
    <p>
        <a href="{billing_link}" style="display: inline-block; padding: 12px 24px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Resume API Access
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        Need help? Contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            org_name = org_name,
            current_spend = current_spend,
            cap_amount = cap_amount,
            billing_link = billing_link,
            support_email = self.config.support_email,
            app_name = self.config.app_name,
        );

        self.send_email(
            to,
            &format!("API Access Paused - {}", self.config.app_name),
            &html,
        )
        .await
    }

    /// Send instant charge notification ($50+ overage threshold)
    pub async fn send_instant_charge(
        &self,
        to: &str,
        org_name: &str,
        amount_cents: i32,
        overage_count: i64,
    ) -> BillingResult<bool> {
        let billing_link = format!("{}/billing", self.config.dashboard_url);
        let amount = format!("${:.2}", amount_cents as f64 / 100.0);

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #6366f1;">Instant Overage Charge</h2>
    <p>Hi there,</p>
    <p>An instant overage charge of <strong>{amount}</strong> has been processed for <strong>{org_name}</strong>.</p>
    <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0 0 8px 0;"><strong>Amount Charged:</strong> {amount}</p>
        <p style="margin: 0;"><strong>Overage Requests:</strong> {overage_count} calls over limit</p>
    </div>
    <p>This charge was triggered because your accumulated overage exceeded the $50.00 threshold. This helps prevent large bills from accumulating.</p>
    <p>
        <a href="{billing_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            View Billing Details
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        Questions? Contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            amount = amount,
            org_name = org_name,
            overage_count = overage_count,
            billing_link = billing_link,
            support_email = self.config.support_email,
            app_name = self.config.app_name,
        );

        self.send_email(
            to,
            &format!(
                "Instant Overage Charge: {} - {}",
                amount, self.config.app_name
            ),
            &html,
        )
        .await
    }

    /// Send pay-now confirmation notification
    pub async fn send_pay_now_confirmation(
        &self,
        to: &str,
        org_name: &str,
        amount_cents: i32,
        charge_count: i32,
    ) -> BillingResult<bool> {
        let billing_link = format!("{}/billing", self.config.dashboard_url);
        let amount = format!("${:.2}", amount_cents as f64 / 100.0);

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #16a34a;">Payment Received</h2>
    <p>Hi there,</p>
    <p>Thank you! Your overage payment of <strong>{amount}</strong> for <strong>{org_name}</strong> has been processed.</p>
    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0 0 8px 0; color: #16a34a;"><strong>Status:</strong> Paid</p>
        <p style="margin: 0 0 8px 0;"><strong>Amount:</strong> {amount}</p>
        <p style="margin: 0;"><strong>Charges Cleared:</strong> {charge_count}</p>
    </div>
    <p>Your overage balance is now clear. You can view your billing history in the dashboard.</p>
    <p>
        <a href="{billing_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            View Billing
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        Questions? Contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            amount = amount,
            org_name = org_name,
            charge_count = charge_count,
            billing_link = billing_link,
            support_email = self.config.support_email,
            app_name = self.config.app_name,
        );

        self.send_email(
            to,
            &format!("Payment Received: {} - {}", amount, self.config.app_name),
            &html,
        )
        .await
    }

    /// Send member suspended notification (due to plan downgrade)
    pub async fn send_member_suspended(&self, to: &str, new_tier: &str) -> BillingResult<bool> {
        let tier_display = match new_tier {
            "free" => "Free",
            "pro" => "Pro",
            "team" => "Team",
            "enterprise" => "Enterprise",
            _ => new_tier,
        };

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #f59e0b;">Account Access Changed</h2>
    <p>Hi there,</p>
    <p>Your organization's subscription has been changed to the <strong>{tier_display}</strong> plan, which has a limited number of team members.</p>
    <div style="background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0; color: #b45309;"><strong>Your access has been set to read-only.</strong></p>
    </div>
    <p>You can still view MCPs, analytics, and other resources, but you won't be able to create or modify anything until the organization owner restores your full access.</p>
    <p>Please contact your organization owner if you need full access restored.</p>
    <p style="color: #666; font-size: 14px;">
        Questions? Contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            tier_display = tier_display,
            support_email = self.config.support_email,
            app_name = self.config.app_name,
        );

        self.send_email(
            to,
            &format!("Account Access Changed - {}", self.config.app_name),
            &html,
        )
        .await
    }
}
