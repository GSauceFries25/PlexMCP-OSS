//! Stripe customer management

use sqlx::PgPool;
use stripe::{CreateCustomer, Customer, CustomerId, UpdateCustomer};
use uuid::Uuid;

use crate::client::StripeClient;
use crate::error::{BillingError, BillingResult};

/// Customer service for managing Stripe customers
pub struct CustomerService {
    stripe: StripeClient,
    pool: PgPool,
}

impl CustomerService {
    pub fn new(stripe: StripeClient, pool: PgPool) -> Self {
        Self { stripe, pool }
    }

    /// Create or get a Stripe customer for an organization
    pub async fn get_or_create_customer(
        &self,
        org_id: Uuid,
        email: &str,
        name: &str,
    ) -> BillingResult<Customer> {
        // Check if org already has a Stripe customer ID
        let existing: Option<(Option<String>,)> =
            sqlx::query_as("SELECT stripe_customer_id FROM organizations WHERE id = $1")
                .bind(org_id)
                .fetch_optional(&self.pool)
                .await?;

        if let Some((Some(customer_id),)) = existing {
            // Retrieve existing customer
            let customer_id = customer_id
                .parse::<CustomerId>()
                .map_err(|e| BillingError::StripeApi(format!("Invalid customer ID: {}", e)))?;

            let customer = Customer::retrieve(self.stripe.inner(), &customer_id, &[]).await?;

            return Ok(customer);
        }

        // Create new customer
        let customer = self.create_customer(org_id, email, name).await?;
        Ok(customer)
    }

    /// Create a new Stripe customer
    pub async fn create_customer(
        &self,
        org_id: Uuid,
        email: &str,
        name: &str,
    ) -> BillingResult<Customer> {
        let mut metadata = std::collections::HashMap::new();
        metadata.insert("org_id".to_string(), org_id.to_string());
        metadata.insert("platform".to_string(), "plexmcp".to_string());

        let params = CreateCustomer {
            email: Some(email),
            name: Some(name),
            metadata: Some(metadata),
            ..Default::default()
        };

        let customer = Customer::create(self.stripe.inner(), params).await?;

        // Store customer ID in database
        sqlx::query(
            "UPDATE organizations SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(customer.id.as_str())
        .bind(org_id)
        .execute(&self.pool)
        .await?;

        tracing::info!(
            org_id = %org_id,
            customer_id = %customer.id,
            "Created Stripe customer"
        );

        Ok(customer)
    }

    /// Update a Stripe customer's information
    pub async fn update_customer(
        &self,
        org_id: Uuid,
        email: Option<&str>,
        name: Option<&str>,
    ) -> BillingResult<Customer> {
        let customer_id = self.get_customer_id(org_id).await?;

        let mut params = UpdateCustomer::default();

        if let Some(email) = email {
            params.email = Some(email);
        }
        if let Some(name) = name {
            params.name = Some(name);
        }

        let customer = Customer::update(self.stripe.inner(), &customer_id, params).await?;

        tracing::info!(
            org_id = %org_id,
            customer_id = %customer.id,
            "Updated Stripe customer"
        );

        Ok(customer)
    }

    /// Get the Stripe customer ID for an organization
    pub async fn get_customer_id(&self, org_id: Uuid) -> BillingResult<CustomerId> {
        let result: Option<(Option<String>,)> =
            sqlx::query_as("SELECT stripe_customer_id FROM organizations WHERE id = $1")
                .bind(org_id)
                .fetch_optional(&self.pool)
                .await?;

        match result {
            Some((Some(id),)) => id
                .parse::<CustomerId>()
                .map_err(|e| BillingError::StripeApi(format!("Invalid customer ID: {}", e))),
            _ => Err(BillingError::CustomerNotFound(org_id.to_string())),
        }
    }

    /// Check if an organization has a Stripe customer
    pub async fn has_customer(&self, org_id: Uuid) -> BillingResult<bool> {
        let result: Option<(Option<String>,)> =
            sqlx::query_as("SELECT stripe_customer_id FROM organizations WHERE id = $1")
                .bind(org_id)
                .fetch_optional(&self.pool)
                .await?;

        Ok(matches!(result, Some((Some(_),))))
    }

    /// Check if an organization has a payment method on file in Stripe
    pub async fn has_payment_method(&self, org_id: Uuid) -> BillingResult<bool> {
        // First check if they have a customer
        let result: Option<(Option<String>,)> =
            sqlx::query_as("SELECT stripe_customer_id FROM organizations WHERE id = $1")
                .bind(org_id)
                .fetch_optional(&self.pool)
                .await?;

        let customer_id_str = match result {
            Some((Some(id),)) => id,
            _ => return Ok(false), // No customer = no payment method
        };

        // Parse customer ID and retrieve from Stripe
        let customer_id = customer_id_str
            .parse::<CustomerId>()
            .map_err(|e| BillingError::StripeApi(format!("Invalid customer ID: {}", e)))?;

        let customer = Customer::retrieve(self.stripe.inner(), &customer_id, &[]).await?;

        // Check if customer has a default payment method set
        let has_pm = customer
            .invoice_settings
            .and_then(|settings| settings.default_payment_method)
            .is_some();

        tracing::debug!(
            org_id = %org_id,
            customer_id = %customer.id,
            has_payment_method = has_pm,
            "Checked payment method status"
        );

        Ok(has_pm)
    }
}
