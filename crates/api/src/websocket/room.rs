//! Ticket room management for pub/sub
//!
//! Manages ticket "rooms" for broadcasting events to all subscribers.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::connection::Connection;
use super::events::ServerEvent;

/// Manages ticket "rooms" for broadcasting events
pub struct RoomManager {
    /// Map of ticket_id -> list of connections
    rooms: Arc<RwLock<HashMap<Uuid, Vec<Arc<Connection>>>>>,
}

impl RoomManager {
    /// Create a new room manager
    pub fn new() -> Self {
        Self {
            rooms: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Add a connection to a ticket room
    pub async fn join(&self, ticket_id: Uuid, conn: Arc<Connection>) {
        let mut rooms = self.rooms.write().await;
        rooms.entry(ticket_id).or_insert_with(Vec::new).push(Arc::clone(&conn));

        let count = rooms.get(&ticket_id).map(|v| v.len()).unwrap_or(0);
        tracing::debug!(
            ticket_id = %ticket_id,
            session_id = %conn.session_id,
            room_size = count,
            "Connection joined ticket room"
        );
    }

    /// Remove a connection from a ticket room
    pub async fn leave(&self, ticket_id: &Uuid, session_id: &Uuid) {
        let mut rooms = self.rooms.write().await;
        if let Some(conns) = rooms.get_mut(ticket_id) {
            conns.retain(|c| c.session_id != *session_id);

            // Clean up empty rooms
            if conns.is_empty() {
                rooms.remove(ticket_id);
                tracing::debug!(
                    ticket_id = %ticket_id,
                    "Removed empty ticket room"
                );
            } else {
                tracing::debug!(
                    ticket_id = %ticket_id,
                    session_id = %session_id,
                    room_size = conns.len(),
                    "Connection left ticket room"
                );
            }
        }
    }

    /// Broadcast an event to all connections in a ticket room
    ///
    /// Silently ignores send errors (closed connections will be cleaned up)
    pub async fn broadcast(&self, ticket_id: &Uuid, event: ServerEvent) {
        let rooms = self.rooms.read().await;
        if let Some(conns) = rooms.get(ticket_id) {
            let mut success_count = 0;
            let mut failed_count = 0;

            for conn in conns {
                match conn.send(event.clone()) {
                    Ok(()) => success_count += 1,
                    Err(_) => {
                        failed_count += 1;
                        tracing::warn!(
                            session_id = %conn.session_id,
                            "Failed to send event to connection (likely closed)"
                        );
                    }
                }
            }

            tracing::debug!(
                ticket_id = %ticket_id,
                event_type = ?event,
                recipients = success_count,
                failed = failed_count,
                "Broadcast event to ticket room"
            );
        } else {
            tracing::warn!(
                ticket_id = %ticket_id,
                event_type = ?event,
                "No room found for ticket - no subscribers"
            );
        }
    }

    /// Remove a connection from all rooms
    pub async fn remove_connection(&self, session_id: &Uuid) {
        let mut rooms = self.rooms.write().await;
        let mut removed_from = Vec::new();

        for (ticket_id, conns) in rooms.iter_mut() {
            let before_len = conns.len();
            conns.retain(|c| c.session_id != *session_id);
            if conns.len() < before_len {
                removed_from.push(*ticket_id);
            }
        }

        // Clean up empty rooms
        rooms.retain(|_, conns| !conns.is_empty());

        if !removed_from.is_empty() {
            tracing::debug!(
                session_id = %session_id,
                ticket_count = removed_from.len(),
                "Removed connection from rooms"
            );
        }
    }

    /// Get room size (number of connections) for a ticket
    pub async fn get_room_size(&self, ticket_id: &Uuid) -> usize {
        let rooms = self.rooms.read().await;
        rooms.get(ticket_id).map(|v| v.len()).unwrap_or(0)
    }

    /// Get total number of active rooms
    pub async fn get_room_count(&self) -> usize {
        let rooms = self.rooms.read().await;
        rooms.len()
    }
}

impl Default for RoomManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn test_room_join_and_leave() {
        let room_manager = RoomManager::new();
        let ticket_id = Uuid::new_v4();

        let (tx, _rx) = mpsc::unbounded_channel();
        let conn = Arc::new(Connection::new(Uuid::new_v4(), tx));

        // Initially room doesn't exist
        assert_eq!(room_manager.get_room_size(&ticket_id).await, 0);

        // Join room
        room_manager.join(ticket_id, Arc::clone(&conn)).await;
        assert_eq!(room_manager.get_room_size(&ticket_id).await, 1);

        // Leave room
        room_manager.leave(&ticket_id, &conn.session_id).await;
        assert_eq!(room_manager.get_room_size(&ticket_id).await, 0);
    }

    #[tokio::test]
    async fn test_broadcast_to_room() {
        let room_manager = RoomManager::new();
        let ticket_id = Uuid::new_v4();

        let (tx1, mut rx1) = mpsc::unbounded_channel();
        let (tx2, mut rx2) = mpsc::unbounded_channel();

        let conn1 = Arc::new(Connection::new(Uuid::new_v4(), tx1));
        let conn2 = Arc::new(Connection::new(Uuid::new_v4(), tx2));

        room_manager.join(ticket_id, conn1).await;
        room_manager.join(ticket_id, conn2).await;

        // Broadcast event
        let event = ServerEvent::Pong;
        room_manager.broadcast(&ticket_id, event).await;

        // Both connections should receive the event
        assert!(rx1.try_recv().is_ok());
        assert!(rx2.try_recv().is_ok());
    }

    #[tokio::test]
    async fn test_remove_connection_from_all_rooms() {
        let room_manager = RoomManager::new();
        let ticket1 = Uuid::new_v4();
        let ticket2 = Uuid::new_v4();

        let (tx, _rx) = mpsc::unbounded_channel();
        let conn = Arc::new(Connection::new(Uuid::new_v4(), tx));

        room_manager.join(ticket1, Arc::clone(&conn)).await;
        room_manager.join(ticket2, Arc::clone(&conn)).await;

        assert_eq!(room_manager.get_room_count().await, 2);

        // Remove connection from all rooms
        room_manager.remove_connection(&conn.session_id).await;

        assert_eq!(room_manager.get_room_count().await, 0);
    }
}
