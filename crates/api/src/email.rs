//! Email notifications for security events
//!
//! Sends transactional emails via Resend API for security-related events.

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
                .unwrap_or_else(|_| "PlexMCP <noreply@localhost>".to_string()),
            app_name: std::env::var("APP_NAME").unwrap_or_else(|_| "PlexMCP".to_string()),
            support_email: std::env::var("SUPPORT_EMAIL")
                .unwrap_or_else(|_| "support@localhost".to_string()),
            dashboard_url: std::env::var("PUBLIC_URL")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
        }
    }

    /// Check if email sending is enabled
    pub fn is_enabled(&self) -> bool {
        !self.resend_api_key.is_empty()
    }
}

/// Security email notification service
#[derive(Clone)]
pub struct SecurityEmailService {
    config: EmailConfig,
    client: reqwest::Client,
}

impl SecurityEmailService {
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

    /// Check if email sending is enabled
    pub fn is_enabled(&self) -> bool {
        self.config.is_enabled()
    }

    /// Send an email via Resend API
    async fn send_email(&self, to: &str, subject: &str, html: &str) {
        if !self.config.is_enabled() {
            tracing::warn!("Email not configured, skipping: {}", subject);
            return;
        }

        let body = serde_json::json!({
            "from": self.config.email_from,
            "to": [to],
            "subject": subject,
            "html": html
        });

        let response = self
            .client
            .post("https://api.resend.com/emails")
            .header("Authorization", format!("Bearer {}", self.config.resend_api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await;

        match response {
            Ok(resp) if resp.status().is_success() => {
                tracing::info!(to = %to, subject = %subject, "Security email sent");
            }
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                tracing::error!(
                    status = %status,
                    body = %body,
                    "Failed to send security email"
                );
            }
            Err(e) => {
                tracing::error!(error = %e, "Failed to send security email");
            }
        }
    }

    /// Send 2FA enabled notification
    pub async fn send_2fa_enabled(&self, to: &str, ip_address: Option<&str>) {
        let ip_info = ip_address
            .map(|ip| format!("<p style=\"color: #666; font-size: 14px;\">IP Address: {}</p>", ip))
            .unwrap_or_default();

        let settings_link = format!("{}/settings", self.config.dashboard_url);

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #059669;">Two-Factor Authentication Enabled</h2>
    <p>Hi there,</p>
    <p>Two-factor authentication has been successfully enabled on your {app_name} account.</p>
    <p>From now on, you'll need to enter a verification code from your authenticator app when logging in.</p>
    <div style="background-color: #ecfdf5; border-left: 4px solid #059669; padding: 16px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Your account is now more secure!</strong></p>
        <p style="margin: 8px 0 0 0;">Keep your backup codes in a safe place in case you lose access to your authenticator app.</p>
    </div>
    {ip_info}
    <p>
        <a href="{settings_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            View Security Settings
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        If you didn't make this change, please contact us immediately at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            app_name = self.config.app_name,
            ip_info = ip_info,
            settings_link = settings_link,
            support_email = self.config.support_email,
        );

        self.send_email(
            to,
            &format!("Two-Factor Authentication Enabled - {}", self.config.app_name),
            &html,
        )
        .await;
    }

    /// Send 2FA disabled notification
    pub async fn send_2fa_disabled(&self, to: &str, ip_address: Option<&str>) {
        let ip_info = ip_address
            .map(|ip| format!("<p style=\"color: #666; font-size: 14px;\">IP Address: {}</p>", ip))
            .unwrap_or_default();

        let settings_link = format!("{}/settings", self.config.dashboard_url);

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #dc2626;">Two-Factor Authentication Disabled</h2>
    <p>Hi there,</p>
    <p>Two-factor authentication has been disabled on your {app_name} account.</p>
    <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Your account is now less secure.</strong></p>
        <p style="margin: 8px 0 0 0;">We strongly recommend keeping two-factor authentication enabled to protect your account.</p>
    </div>
    {ip_info}
    <p>
        <a href="{settings_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Re-enable 2FA
        </a>
    </p>
    <p style="color: #dc2626; font-size: 14px; font-weight: bold;">
        If you didn't make this change, your account may be compromised. Please contact us immediately at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            app_name = self.config.app_name,
            ip_info = ip_info,
            settings_link = settings_link,
            support_email = self.config.support_email,
        );

        self.send_email(
            to,
            &format!("Two-Factor Authentication Disabled - {}", self.config.app_name),
            &html,
        )
        .await;
    }

    /// Send password changed notification
    pub async fn send_password_changed(&self, to: &str, ip_address: Option<&str>) {
        let ip_info = ip_address
            .map(|ip| format!("<p style=\"color: #666; font-size: 14px;\">IP Address: {}</p>", ip))
            .unwrap_or_default();

        let settings_link = format!("{}/settings", self.config.dashboard_url);

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #059669;">Password Changed Successfully</h2>
    <p>Hi there,</p>
    <p>Your {app_name} password was changed successfully.</p>
    <div style="background-color: #ecfdf5; border-left: 4px solid #059669; padding: 16px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Your account security has been updated.</strong></p>
        <p style="margin: 8px 0 0 0;">You'll need to use your new password for future sign-ins.</p>
    </div>
    {ip_info}
    <p style="color: #dc2626; font-size: 14px; font-weight: bold;">
        If you didn't make this change, your account may be compromised. Please reset your password immediately and contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <p>
        <a href="{settings_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            View Security Settings
        </a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            app_name = self.config.app_name,
            ip_info = ip_info,
            settings_link = settings_link,
            support_email = self.config.support_email,
        );

        self.send_email(
            to,
            &format!("Password Changed - {}", self.config.app_name),
            &html,
        )
        .await;
    }

    /// Send account linked notification (OAuth provider connected)
    pub async fn send_account_linked(&self, to: &str, provider: &str, ip_address: Option<&str>) {
        let ip_info = ip_address
            .map(|ip| format!("<p style=\"color: #666; font-size: 14px;\">IP Address: {}</p>", ip))
            .unwrap_or_default();

        let settings_link = format!("{}/settings", self.config.dashboard_url);
        let provider_display = match provider.to_lowercase().as_str() {
            "google" => "Google",
            "github" => "GitHub",
            _ => provider,
        };

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #059669;">{provider_display} Account Connected</h2>
    <p>Hi there,</p>
    <p>Your {provider_display} account has been connected to your {app_name} account.</p>
    <div style="background-color: #ecfdf5; border-left: 4px solid #059669; padding: 16px; margin: 20px 0;">
        <p style="margin: 0;"><strong>New sign-in method added!</strong></p>
        <p style="margin: 8px 0 0 0;">You can now use {provider_display} to sign in to your account.</p>
    </div>
    {ip_info}
    <p>
        <a href="{settings_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Manage Connected Accounts
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        If you didn't make this change, please review your connected accounts at <a href="{settings_link}">{settings_link}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            app_name = self.config.app_name,
            provider_display = provider_display,
            ip_info = ip_info,
            settings_link = settings_link,
        );

        self.send_email(
            to,
            &format!("{} Account Connected - {}", provider_display, self.config.app_name),
            &html,
        )
        .await;
    }

    /// Send account unlinked notification (OAuth provider disconnected)
    pub async fn send_account_unlinked(&self, to: &str, provider: &str, ip_address: Option<&str>) {
        let ip_info = ip_address
            .map(|ip| format!("<p style=\"color: #666; font-size: 14px;\">IP Address: {}</p>", ip))
            .unwrap_or_default();

        let settings_link = format!("{}/settings", self.config.dashboard_url);
        let provider_display = match provider.to_lowercase().as_str() {
            "google" => "Google",
            "github" => "GitHub",
            _ => provider,
        };

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #f59e0b;">{provider_display} Account Disconnected</h2>
    <p>Hi there,</p>
    <p>Your {provider_display} account has been disconnected from your {app_name} account.</p>
    <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Sign-in method removed.</strong></p>
        <p style="margin: 8px 0 0 0;">You can no longer use {provider_display} to sign in. Make sure you have another way to access your account.</p>
    </div>
    {ip_info}
    <p>
        <a href="{settings_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Manage Connected Accounts
        </a>
    </p>
    <p style="color: #dc2626; font-size: 14px; font-weight: bold;">
        If you didn't make this change, your account may be compromised. Please contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            app_name = self.config.app_name,
            provider_display = provider_display,
            ip_info = ip_info,
            settings_link = settings_link,
            support_email = self.config.support_email,
        );

        self.send_email(
            to,
            &format!("{} Account Disconnected - {}", provider_display, self.config.app_name),
            &html,
        )
        .await;
    }

    /// Send team invitation email
    pub async fn send_invitation_email(
        &self,
        to: &str,
        org_name: &str,
        inviter_name: &str,
        role: &str,
        accept_url: &str,
        expires_in_days: i32,
    ) {
        let role_display = match role {
            "admin" => "an Admin",
            "member" => "a Member",
            "viewer" => "a Viewer",
            _ => "a team member",
        };

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #6366f1;">You've Been Invited to Join {org_name}</h2>
    <p>Hi there,</p>
    <p><strong>{inviter_name}</strong> has invited you to join <strong>{org_name}</strong> as {role_display} on {app_name}.</p>
    <div style="background-color: #f0f4ff; border-left: 4px solid #6366f1; padding: 16px; margin: 20px 0;">
        <p style="margin: 0;"><strong>What is {app_name}?</strong></p>
        <p style="margin: 8px 0 0 0;">{app_name} is a unified MCP proxy that lets teams manage AI tool integrations securely and efficiently.</p>
    </div>
    <p>
        <a href="{accept_url}" style="display: inline-block; padding: 14px 28px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
            Accept Invitation
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        This invitation expires in <strong>{expires_in_days} days</strong>.
    </p>
    <p style="color: #666; font-size: 14px;">
        If you didn't expect this invitation, you can safely ignore this email.
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">
        {app_name} &bull; <a href="mailto:{support_email}" style="color: #999;">{support_email}</a>
    </p>
</body>
</html>"#,
            app_name = self.config.app_name,
            org_name = org_name,
            inviter_name = inviter_name,
            role_display = role_display,
            accept_url = accept_url,
            expires_in_days = expires_in_days,
            support_email = self.config.support_email,
        );

        self.send_email(
            to,
            &format!("You've been invited to join {} on {}", org_name, self.config.app_name),
            &html,
        )
        .await;
    }

    /// Send invitation accepted notification (welcome email)
    pub async fn send_invitation_accepted(&self, to: &str, org_name: &str) {
        let dashboard_link = self.config.dashboard_url.clone();

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #059669;">Welcome to {org_name}!</h2>
    <p>Hi there,</p>
    <p>You've successfully joined <strong>{org_name}</strong> on {app_name}. Your account is now active and ready to use.</p>
    <div style="background-color: #ecfdf5; border-left: 4px solid #059669; padding: 16px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Getting Started</strong></p>
        <p style="margin: 8px 0 0 0;">Head to your dashboard to explore your team's MCP integrations and start collaborating.</p>
    </div>
    <p>
        <a href="{dashboard_link}" style="display: inline-block; padding: 14px 28px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
            Go to Dashboard
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        Need help? Check out our documentation or contact your team admin.
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">
        {app_name} &bull; <a href="mailto:{support_email}" style="color: #999;">{support_email}</a>
    </p>
</body>
</html>"#,
            app_name = self.config.app_name,
            org_name = org_name,
            dashboard_link = dashboard_link,
            support_email = self.config.support_email,
        );

        self.send_email(
            to,
            &format!("Welcome to {} - {}", org_name, self.config.app_name),
            &html,
        )
        .await;
    }

    /// Send backup code used notification
    pub async fn send_backup_code_used(&self, to: &str, remaining_codes: i64) {
        let settings_link = format!("{}/settings", self.config.dashboard_url);

        let warning = if remaining_codes <= 3 {
            format!(
                r#"<div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin: 20px 0;">
                    <p style="margin: 0; color: #dc2626;"><strong>Warning: Only {} backup code{} remaining!</strong></p>
                    <p style="margin: 8px 0 0 0;">You should regenerate your backup codes soon to avoid being locked out.</p>
                </div>"#,
                remaining_codes,
                if remaining_codes == 1 { "" } else { "s" }
            )
        } else {
            format!(
                r#"<p>You have <strong>{} backup codes</strong> remaining.</p>"#,
                remaining_codes
            )
        };

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #f59e0b;">Backup Code Used</h2>
    <p>Hi there,</p>
    <p>A backup code was just used to sign in to your {app_name} account.</p>
    {warning}
    <p>
        <a href="{settings_link}" style="display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Manage Security Settings
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        If you didn't use this backup code, your account may be compromised. Please contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">{app_name}</p>
</body>
</html>"#,
            app_name = self.config.app_name,
            warning = warning,
            settings_link = settings_link,
            support_email = self.config.support_email,
        );

        self.send_email(
            to,
            &format!("Backup Code Used - {}", self.config.app_name),
            &html,
        )
        .await;
    }

    /// Send email verification link
    pub async fn send_email_verification(&self, to: &str, verification_token: &str) {
        let verification_link = format!(
            "{}/auth/verify-email?token={}",
            self.config.dashboard_url,
            verification_token
        );

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #6366f1;">Welcome to {app_name}!</h2>
    <p>Hi there,</p>
    <p>Thanks for signing up! Please verify your email address to activate your account.</p>
    <div style="background-color: #f0f4ff; border-left: 4px solid #6366f1; padding: 16px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Why verify your email?</strong></p>
        <p style="margin: 8px 0 0 0;">Email verification helps us keep your account secure and ensures you can recover access if needed.</p>
    </div>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{verification_link}" style="display: inline-block; padding: 14px 28px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
            Verify Email Address
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        This verification link expires in <strong>24 hours</strong>.
    </p>
    <p style="color: #666; font-size: 14px;">
        If you didn't create an account with {app_name}, you can safely ignore this email.
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">
        {app_name} &bull; <a href="mailto:{support_email}" style="color: #999;">{support_email}</a>
    </p>
</body>
</html>"#,
            app_name = self.config.app_name,
            verification_link = verification_link,
            support_email = self.config.support_email,
        );

        self.send_email(
            to,
            &format!("Verify Your Email - {}", self.config.app_name),
            &html,
        )
        .await;
    }

    /// Send password reset link
    pub async fn send_password_reset(&self, to: &str, reset_token: &str) {
        let reset_link = format!(
            "{}/auth/reset-password?token={}",
            self.config.dashboard_url,
            reset_token
        );

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #6366f1;">Password Reset Requested</h2>
    <p>Hi there,</p>
    <p>We received a request to reset your password for your {app_name} account.</p>
    <div style="background-color: #f0f4ff; border-left: 4px solid #6366f1; padding: 16px; margin: 20px 0;">
        <p style="margin: 0;"><strong>Reset your password</strong></p>
        <p style="margin: 8px 0 0 0;">Click the button below to choose a new password. This link expires in 24 hours for security.</p>
    </div>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{reset_link}" style="display: inline-block; padding: 14px 28px; background-color: #6366f1; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
            Reset Password
        </a>
    </p>
    <p style="color: #dc2626; font-size: 14px; font-weight: bold;">
        If you didn't request a password reset, please ignore this email and your password will remain unchanged.
    </p>
    <p style="color: #666; font-size: 14px;">
        For security, this reset link expires in <strong>24 hours</strong>.
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">
        {app_name} &bull; <a href="mailto:{support_email}" style="color: #999;">{support_email}</a>
    </p>
</body>
</html>"#,
            app_name = self.config.app_name,
            reset_link = reset_link,
            support_email = self.config.support_email,
        );

        self.send_email(
            to,
            &format!("Password Reset - {}", self.config.app_name),
            &html,
        )
        .await;
    }

    /// Send service suspension notification
    pub async fn send_service_suspended(
        &self,
        to: &str,
        org_name: &str,
        amount_owed_cents: i64,
        reason: &str,
    ) {
        let amount_owed = format!("${:.2}", amount_owed_cents as f64 / 100.0);
        let billing_link = format!("{}/settings/billing", self.config.dashboard_url);

        let html = format!(
            r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #dc2626;">Service Suspended - {org_name}</h2>
    <p>Hi there,</p>
    <p>Your {app_name} service for <strong>{org_name}</strong> has been suspended due to unpaid invoices.</p>
    <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin: 20px 0;">
        <p style="margin: 0; color: #dc2626;"><strong>Outstanding Balance: {amount_owed}</strong></p>
        <p style="margin: 8px 0 0 0;">{reason}</p>
    </div>
    <p><strong>What This Means:</strong></p>
    <ul>
        <li>Your MCP proxy access has been disabled</li>
        <li>Your team members cannot access the service</li>
        <li>Your data is safe and will be restored upon payment</li>
    </ul>
    <p><strong>To Restore Service:</strong></p>
    <ol>
        <li>Pay your outstanding invoices</li>
        <li>Your service will be automatically reactivated</li>
        <li>Contact support if you need payment assistance</li>
    </ol>
    <p style="text-align: center; margin: 30px 0;">
        <a href="{billing_link}" style="display: inline-block; padding: 14px 28px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
            Pay Invoices Now
        </a>
    </p>
    <p style="color: #666; font-size: 14px;">
        If you have questions or disputes about this suspension, please reply to this email or contact us at <a href="mailto:{support_email}">{support_email}</a>
    </p>
    <p style="color: #666; font-size: 14px;">
        <strong>Note:</strong> If payment is not received within 60 days, your account and data may be permanently deleted according to our Terms of Service.
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">
        {app_name} &bull; <a href="mailto:{support_email}" style="color: #999;">{support_email}</a>
    </p>
</body>
</html>"#,
            app_name = self.config.app_name,
            org_name = org_name,
            amount_owed = amount_owed,
            reason = reason,
            billing_link = billing_link,
            support_email = self.config.support_email,
        );

        self.send_email(
            to,
            &format!("Service Suspended - {} - {}", org_name, self.config.app_name),
            &html,
        )
        .await;
    }
}
