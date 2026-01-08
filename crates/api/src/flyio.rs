//! Fly.io API integration for SSL certificate provisioning
//!
//! When a custom domain's DNS is verified, this module provisions
//! an SSL certificate via Fly.io's GraphQL API.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

/// Fly.io GraphQL API endpoint
const FLY_API_URL: &str = "https://api.fly.io/graphql";

/// Client for interacting with Fly.io API
#[derive(Clone)]
pub struct FlyClient {
    client: Client,
    api_token: String,
    app_name: String,
}

#[derive(Debug, Serialize)]
struct GraphQLRequest {
    query: &'static str,
    variables: AddCertificateVariables,
}

#[derive(Debug, Serialize)]
struct AddCertificateVariables {
    #[serde(rename = "appId")]
    app_id: String,
    hostname: String,
}

#[derive(Debug, Deserialize)]
struct GraphQLResponse {
    data: Option<AddCertificateData>,
    errors: Option<Vec<GraphQLError>>,
}

#[derive(Debug, Deserialize)]
struct AddCertificateData {
    #[serde(rename = "addCertificate")]
    add_certificate: Option<AddCertificateResult>,
}

#[derive(Debug, Deserialize)]
struct AddCertificateResult {
    certificate: Option<CertificateInfo>,
}

#[derive(Debug, Deserialize)]
pub struct CertificateInfo {
    pub id: Option<String>,
    pub hostname: Option<String>,
    pub configured: Option<bool>,
    #[serde(rename = "certificateAuthority")]
    pub certificate_authority: Option<String>,
    #[serde(rename = "dnsProvider")]
    pub dns_provider: Option<String>,
    #[serde(rename = "dnsValidationInstructions")]
    pub dns_validation_instructions: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // Fields populated from JSON deserialization
struct GraphQLError {
    message: String,
    path: Option<Vec<String>>,
}

impl FlyClient {
    /// Create a new Fly.io client from config
    pub fn new(api_token: String, app_name: String) -> Self {
        Self {
            client: Client::new(),
            api_token,
            app_name,
        }
    }

    /// Create from environment config, returns None if not configured
    pub fn from_config(
        fly_api_token: Option<String>,
        fly_app_name: Option<String>,
    ) -> Option<Self> {
        match (fly_api_token, fly_app_name) {
            (Some(token), Some(app)) if !token.is_empty() && !app.is_empty() => {
                Some(Self::new(token, app))
            }
            _ => {
                warn!("Fly.io API not configured - custom domain SSL will not be auto-provisioned");
                None
            }
        }
    }

    /// Add an SSL certificate for a custom domain
    ///
    /// Returns Ok(CertificateInfo) on success, or an error message on failure.
    /// Note: The certificate is issued asynchronously by Let's Encrypt,
    /// so this just initiates the process.
    pub async fn add_certificate(&self, hostname: &str) -> Result<CertificateInfo, String> {
        const MUTATION: &str = r#"
            mutation($appId: ID!, $hostname: String!) {
                addCertificate(appId: $appId, hostname: $hostname) {
                    certificate {
                        id
                        hostname
                        configured
                        certificateAuthority
                        dnsProvider
                        dnsValidationInstructions
                    }
                }
            }
        "#;

        let request = GraphQLRequest {
            query: MUTATION,
            variables: AddCertificateVariables {
                app_id: self.app_name.clone(),
                hostname: hostname.to_string(),
            },
        };

        let response = self
            .client
            .post(FLY_API_URL)
            .header("Authorization", format!("Bearer {}", self.api_token))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Failed to call Fly.io API: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            error!("Fly.io API returned error status {}: {}", status, body);
            return Err(format!("Fly.io API error: {} - {}", status, body));
        }

        let result: GraphQLResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Fly.io response: {}", e))?;

        // Check for GraphQL errors
        if let Some(errors) = result.errors {
            let error_msg = errors
                .iter()
                .map(|e| e.message.clone())
                .collect::<Vec<_>>()
                .join("; ");

            // Check if certificate already exists (not really an error)
            if error_msg.contains("already exists") {
                info!("Certificate for {} already exists in Fly.io", hostname);
                return Ok(CertificateInfo {
                    id: None,
                    hostname: Some(hostname.to_string()),
                    configured: Some(true),
                    certificate_authority: Some("Let's Encrypt".to_string()),
                    dns_provider: None,
                    dns_validation_instructions: None,
                });
            }

            error!("Fly.io GraphQL errors for {}: {}", hostname, error_msg);
            return Err(format!("Fly.io error: {}", error_msg));
        }

        // Extract certificate info
        let cert = result
            .data
            .and_then(|d| d.add_certificate)
            .and_then(|ac| ac.certificate)
            .ok_or_else(|| "No certificate data in response".to_string())?;

        info!(
            "Successfully initiated certificate for {} (authority: {:?})",
            hostname, cert.certificate_authority
        );

        Ok(cert)
    }
}
