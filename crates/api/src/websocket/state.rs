//! Global WebSocket state management
//!
//! Maintains global state for all WebSocket connections and rooms.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::connection::Connection;
use super::room::RoomManager;

/// Global WebSocket state shared across all connections
#[derive(Clone)]
pub struct WebSocketState {
    /// All active connections indexed by session_id
    pub connections: Arc<RwLock<HashMap<Uuid, Arc<Connection>>>>,

    /// Room manager for ticket subscriptions
    pub rooms: Arc<RoomManager>,
}

impl WebSocketState {
    /// Create new WebSocket state
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
            rooms: Arc::new(RoomManager::new()),
        }
    }

    /// Add a connection
    pub async fn add_connection(&self, conn: Connection) -> Arc<Connection> {
        let conn = Arc::new(conn);
        let mut connections = self.connections.write().await;
        connections.insert(conn.session_id, Arc::clone(&conn));

        tracing::info!(
            session_id = %conn.session_id,
            user_id = %conn.user_id,
            total_connections = connections.len(),
            "WebSocket connection added"
        );

        conn
    }

    /// Remove a connection
    pub async fn remove_connection(&self, session_id: &Uuid) {
        let mut connections = self.connections.write().await;
        if let Some(conn) = connections.remove(session_id) {
            // Also remove from all rooms
            self.rooms.remove_connection(session_id).await;

            tracing::info!(
                session_id = %session_id,
                user_id = %conn.user_id,
                remaining_connections = connections.len(),
                "WebSocket connection removed"
            );
        }
    }

    /// Get a connection by session ID
    pub async fn get_connection(&self, session_id: &Uuid) -> Option<Arc<Connection>> {
        let connections = self.connections.read().await;
        connections.get(session_id).cloned()
    }

    /// Get all connections for a specific user
    pub async fn get_user_connections(&self, user_id: &Uuid) -> Vec<Arc<Connection>> {
        let connections = self.connections.read().await;
        connections
            .values()
            .filter(|c| c.user_id == *user_id)
            .cloned()
            .collect()
    }

    /// Get total number of active connections
    pub async fn connection_count(&self) -> usize {
        let connections = self.connections.read().await;
        connections.len()
    }

    /// Get statistics about the WebSocket state
    pub async fn get_stats(&self) -> WebSocketStats {
        let connection_count = self.connection_count().await;
        let room_count = self.rooms.get_room_count().await;

        WebSocketStats {
            active_connections: connection_count,
            active_rooms: room_count,
        }
    }
}

impl Default for WebSocketState {
    fn default() -> Self {
        Self::new()
    }
}

/// Statistics about WebSocket connections
#[derive(Debug, Clone)]
pub struct WebSocketStats {
    /// Number of active connections
    pub active_connections: usize,
    /// Number of active ticket rooms
    pub active_rooms: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn test_add_and_remove_connection() {
        let state = WebSocketState::new();
        let (tx, _rx) = mpsc::unbounded_channel();
        let user_id = Uuid::new_v4();

        let conn = Connection::new(user_id, tx);
        let session_id = conn.session_id;

        // Add connection
        let added_conn = state.add_connection(conn).await;
        assert_eq!(state.connection_count().await, 1);
        assert_eq!(added_conn.user_id, user_id);

        // Remove connection
        state.remove_connection(&session_id).await;
        assert_eq!(state.connection_count().await, 0);
    }

    #[tokio::test]
    async fn test_get_user_connections() {
        let state = WebSocketState::new();
        let user_id = Uuid::new_v4();

        // Add two connections for the same user
        let (tx1, _rx1) = mpsc::unbounded_channel();
        let (tx2, _rx2) = mpsc::unbounded_channel();

        state.add_connection(Connection::new(user_id, tx1)).await;
        state.add_connection(Connection::new(user_id, tx2)).await;

        let user_conns = state.get_user_connections(&user_id).await;
        assert_eq!(user_conns.len(), 2);
    }

    #[tokio::test]
    async fn test_stats() {
        let state = WebSocketState::new();
        let (tx, _rx) = mpsc::unbounded_channel();

        state.add_connection(Connection::new(Uuid::new_v4(), tx)).await;

        let stats = state.get_stats().await;
        assert_eq!(stats.active_connections, 1);
        assert_eq!(stats.active_rooms, 0);
    }
}
