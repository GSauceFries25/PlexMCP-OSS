//! Stripe Billing Portal

use stripe::{
    BillingPortalSession, CreateBillingPortalSession, CustomerId,
};
use uuid::Uuid;

use crate::client::StripeClient;
use crate::error::{BillingError, BillingResult};

/// Portal service for Stripe billing portal sessions
pub struct PortalService {
    stripe: StripeClient,
}

impl PortalService {
    pub fn new(stripe: StripeClient) -> Self {
        Self { stripe }
    }

    /// Create a billing portal session for a customer
    pub async fn create_portal_session(
        &self,
        org_id: Uuid,
        customer_id: &str,
    ) -> BillingResult<BillingPortalSession> {
        let customer_id = customer_id.parse::<CustomerId>()
            .map_err(|e| BillingError::StripeApi(format!("Invalid customer ID: {}", e)))?;

        let return_url = format!(
            "{}/billing",
            self.stripe.config().app_base_url
        );

        let mut params = CreateBillingPortalSession::new(customer_id);
        params.return_url = Some(&return_url);

        let session = BillingPortalSession::create(self.stripe.inner(), params).await?;

        tracing::info!(
            org_id = %org_id,
            customer_id = %session.customer,
            "Created billing portal session"
        );

        Ok(session)
    }
}

/// Response for creating a portal session
#[derive(Debug, serde::Serialize)]
pub struct PortalResponse {
    pub url: String,
}

impl From<BillingPortalSession> for PortalResponse {
    fn from(session: BillingPortalSession) -> Self {
        Self {
            url: session.url,
        }
    }
}
