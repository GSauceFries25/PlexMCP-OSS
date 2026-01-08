//! WebSocket connection management
//!
//! Represents an active WebSocket connection with subscription tracking.

use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

use super::events::ServerEvent;

/// Represents an active WebSocket connection
#[derive(Debug)]
pub struct Connection {
    /// Unique session ID for this connection
    pub session_id: Uuid,

    /// Authenticated user ID
    pub user_id: Uuid,

    /// Channel to send events to this connection
    pub sender: mpsc::UnboundedSender<ServerEvent>,

    /// Set of ticket IDs this connection is subscribed to
    pub subscriptions: Arc<RwLock<HashSet<Uuid>>>,
}

impl Connection {
    /// Create a new connection
    pub fn new(user_id: Uuid, sender: mpsc::UnboundedSender<ServerEvent>) -> Self {
        Self {
            session_id: Uuid::new_v4(),
            user_id,
            sender,
            subscriptions: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    /// Send an event to this connection
    ///
    /// Returns Ok(()) if sent successfully, Err if connection is closed
    #[allow(clippy::result_large_err)] // Error type is from tokio mpsc, containing the failed event
    pub fn send(&self, event: ServerEvent) -> Result<(), mpsc::error::SendError<ServerEvent>> {
        self.sender.send(event)
    }

    /// Subscribe to a ticket
    pub async fn subscribe(&self, ticket_id: Uuid) {
        let mut subs = self.subscriptions.write().await;
        subs.insert(ticket_id);
        tracing::debug!(
            session_id = %self.session_id,
            ticket_id = %ticket_id,
            "Subscribed to ticket"
        );
    }

    /// Unsubscribe from a ticket
    pub async fn unsubscribe(&self, ticket_id: Uuid) {
        let mut subs = self.subscriptions.write().await;
        subs.remove(&ticket_id);
        tracing::debug!(
            session_id = %self.session_id,
            ticket_id = %ticket_id,
            "Unsubscribed from ticket"
        );
    }

    /// Check if subscribed to a ticket
    pub async fn is_subscribed(&self, ticket_id: &Uuid) -> bool {
        let subs = self.subscriptions.read().await;
        subs.contains(ticket_id)
    }

    /// Get all ticket subscriptions
    pub async fn get_subscriptions(&self) -> HashSet<Uuid> {
        let subs = self.subscriptions.read().await;
        subs.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_connection_subscription() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let conn = Connection::new(Uuid::new_v4(), tx);
        let ticket_id = Uuid::new_v4();

        // Initially not subscribed
        assert!(!conn.is_subscribed(&ticket_id).await);

        // Subscribe
        conn.subscribe(ticket_id).await;
        assert!(conn.is_subscribed(&ticket_id).await);

        // Unsubscribe
        conn.unsubscribe(ticket_id).await;
        assert!(!conn.is_subscribed(&ticket_id).await);
    }

    #[tokio::test]
    async fn test_multiple_subscriptions() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let conn = Connection::new(Uuid::new_v4(), tx);

        let ticket1 = Uuid::new_v4();
        let ticket2 = Uuid::new_v4();

        conn.subscribe(ticket1).await;
        conn.subscribe(ticket2).await;

        let subs = conn.get_subscriptions().await;
        assert_eq!(subs.len(), 2);
        assert!(subs.contains(&ticket1));
        assert!(subs.contains(&ticket2));
    }
}
