//! Circuit breaker management for MCP instances
//!
//! Implements circuit breaker pattern to prevent cascading failures when MCPs are repeatedly failing.
//! Each MCP instance has its own circuit breaker that opens after consecutive failures and allows
//! periodic test requests to check if the service has recovered.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use uuid::Uuid;

/// Manages circuit breakers for all MCP instances
pub struct McpCircuitBreakerManager {
    breakers: Arc<RwLock<HashMap<Uuid, CircuitBreakerState>>>,
    config: CircuitBreakerConfig,
}

#[derive(Clone)]
pub struct CircuitBreakerConfig {
    /// Number of consecutive failures before opening circuit
    pub failure_threshold: u32,
    /// Minimum backoff duration when circuit opens
    pub min_backoff: Duration,
    /// Maximum backoff duration
    pub max_backoff: Duration,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 5, // Open after 5 consecutive failures
            min_backoff: Duration::from_secs(1),
            max_backoff: Duration::from_secs(60),
        }
    }
}

#[derive(Debug, Clone)]
struct CircuitBreakerState {
    consecutive_failures: u32,
    last_failure_time: Option<Instant>,
    current_backoff: Duration,
}

impl Default for CircuitBreakerState {
    fn default() -> Self {
        Self {
            consecutive_failures: 0,
            last_failure_time: None,
            current_backoff: Duration::from_secs(1),
        }
    }
}

impl McpCircuitBreakerManager {
    pub fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            breakers: Arc::new(RwLock::new(HashMap::new())),
            config,
        }
    }

    /// Check if circuit breaker allows the request
    pub async fn is_call_permitted(&self, mcp_id: Uuid) -> bool {
        let breakers = self.breakers.read().await;

        if let Some(state) = breakers.get(&mcp_id) {
            // Circuit is open if we have enough consecutive failures
            if state.consecutive_failures >= self.config.failure_threshold {
                // Check if backoff period has elapsed
                if let Some(last_failure) = state.last_failure_time {
                    let elapsed = last_failure.elapsed();
                    if elapsed < state.current_backoff {
                        // Still in backoff period - reject call
                        tracing::debug!(
                            mcp_id = %mcp_id,
                            failures = state.consecutive_failures,
                            backoff_remaining = ?state.current_backoff.saturating_sub(elapsed),
                            "Circuit breaker OPEN - rejecting call"
                        );
                        return false;
                    } else {
                        // Backoff period elapsed - allow one test request (half-open state)
                        tracing::debug!(
                            mcp_id = %mcp_id,
                            "Circuit breaker HALF-OPEN - allowing test request"
                        );
                        return true;
                    }
                }
            }
        }

        true // Circuit closed or doesn't exist - allow call
    }

    /// Record a successful call - resets circuit breaker
    pub async fn record_success(&self, mcp_id: Uuid) {
        let mut breakers = self.breakers.write().await;

        if let Some(state) = breakers.get_mut(&mcp_id) {
            if state.consecutive_failures > 0 {
                tracing::info!(
                    mcp_id = %mcp_id,
                    previous_failures = state.consecutive_failures,
                    "Circuit breaker reset - request succeeded"
                );
                *state = CircuitBreakerState::default();
            }
        }
    }

    /// Record a failed call - increments failure count and opens circuit if threshold reached
    pub async fn record_failure(&self, mcp_id: Uuid) {
        let mut breakers = self.breakers.write().await;

        let state = breakers
            .entry(mcp_id)
            .or_insert_with(CircuitBreakerState::default);
        state.consecutive_failures += 1;
        state.last_failure_time = Some(Instant::now());

        // Calculate exponential backoff
        if state.consecutive_failures >= self.config.failure_threshold {
            let backoff_multiplier = 2u32.pow(
                state
                    .consecutive_failures
                    .saturating_sub(self.config.failure_threshold),
            );
            state.current_backoff = self.config.min_backoff * backoff_multiplier;

            if state.current_backoff > self.config.max_backoff {
                state.current_backoff = self.config.max_backoff;
            }

            tracing::warn!(
                mcp_id = %mcp_id,
                consecutive_failures = state.consecutive_failures,
                backoff = ?state.current_backoff,
                "Circuit breaker OPENED"
            );
        } else {
            tracing::debug!(
                mcp_id = %mcp_id,
                consecutive_failures = state.consecutive_failures,
                threshold = self.config.failure_threshold,
                "Failure recorded - circuit still closed"
            );
        }
    }

    /// Execute an async operation with circuit breaker protection
    pub async fn call<F, Fut, T, E>(
        &self,
        mcp_id: Uuid,
        operation: F,
    ) -> Result<T, CircuitBreakerError<E>>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, E>>,
    {
        // Check if call is permitted
        if !self.is_call_permitted(mcp_id).await {
            return Err(CircuitBreakerError::Rejected);
        }

        // Execute the operation
        match operation().await {
            Ok(result) => {
                self.record_success(mcp_id).await;
                Ok(result)
            }
            Err(err) => {
                self.record_failure(mcp_id).await;
                Err(CircuitBreakerError::Inner(err))
            }
        }
    }
}

#[derive(Debug)]
pub enum CircuitBreakerError<E> {
    /// Circuit breaker is open - call rejected
    Rejected,
    /// Inner error from the operation
    Inner(E),
}
