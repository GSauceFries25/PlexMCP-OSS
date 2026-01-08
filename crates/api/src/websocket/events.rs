//! WebSocket event types and serialization
//!
//! Defines all client-to-server and server-to-client event types
//! with type-safe serde serialization.

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

// =============================================================================
// Client-to-Server Events
// =============================================================================

/// Events sent from client to server
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientEvent {
    /// Subscribe to ticket updates
    Subscribe { ticket_id: Uuid },

    /// Unsubscribe from ticket updates
    Unsubscribe { ticket_id: Uuid },

    /// Start typing in a ticket
    TypingStart { ticket_id: Uuid },

    /// Stop typing in a ticket
    TypingStop { ticket_id: Uuid },

    /// Heartbeat ping to keep connection alive
    Ping,

    /// Join ticket as a viewer
    JoinTicketView { ticket_id: Uuid },

    /// Leave ticket view
    LeaveTicketView { ticket_id: Uuid },

    /// Set user presence status (admin only)
    SetPresence {
        status: String, // "online" | "away" | "offline"
    },
}

// =============================================================================
// Server-to-Client Events
// =============================================================================

/// Events sent from server to client
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerEvent {
    /// New message added to ticket
    NewMessage {
        ticket_id: Uuid,
        message: TicketMessageEvent,
    },

    /// Ticket status/priority/assignment changed
    TicketUpdated {
        ticket_id: Uuid,
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        priority: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        assigned_to: Option<Uuid>,
    },

    /// User started typing in ticket
    UserTypingStart {
        ticket_id: Uuid,
        user_id: Uuid,
        user_name: String,
    },

    /// User stopped typing in ticket
    UserTypingStop { ticket_id: Uuid, user_id: Uuid },

    /// User presence status changed
    PresenceUpdate {
        user_id: Uuid,
        online_status: String, // "online" | "away" | "offline"
        #[serde(skip_serializing_if = "Option::is_none")]
        last_activity_at: Option<String>,
    },

    /// Batch presence data (sent on initial connection)
    PresenceBatch { users: Vec<UserPresence> },

    /// Ticket viewers list updated
    ViewersUpdate {
        ticket_id: Uuid,
        viewers: Vec<TicketViewer>,
    },

    /// Heartbeat response
    Pong,

    /// Error message
    Error { message: String },

    /// Connection acknowledged
    Connected { session_id: Uuid },
}

// =============================================================================
// Event Data Structures
// =============================================================================

/// Message event data
#[derive(Debug, Serialize, Clone)]
pub struct TicketMessageEvent {
    pub id: Uuid,
    pub ticket_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_name: Option<String>,
    pub is_admin_reply: bool,
    pub is_internal: bool,
    pub content: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// Ticket viewer data
#[derive(Debug, Serialize, Clone)]
pub struct TicketViewer {
    pub user_id: Uuid,
    pub user_name: String,
    pub user_email: String,
    #[serde(with = "time::serde::rfc3339")]
    pub started_viewing_at: OffsetDateTime,
}

/// User presence data
#[derive(Debug, Serialize, Clone)]
pub struct UserPresence {
    pub user_id: Uuid,
    pub online_status: String, // "online" | "away" | "offline"
    pub last_activity_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_event_deserialization() {
        let json = r#"{"type":"subscribe","ticket_id":"550e8400-e29b-41d4-a716-446655440000"}"#;
        let event: ClientEvent = serde_json::from_str(json).unwrap();
        match event {
            ClientEvent::Subscribe { ticket_id } => {
                assert_eq!(
                    ticket_id.to_string(),
                    "550e8400-e29b-41d4-a716-446655440000"
                );
            }
            _ => panic!("Expected Subscribe event"),
        }
    }

    #[test]
    fn test_server_event_serialization() {
        let event = ServerEvent::Pong;
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, r#"{"type":"pong"}"#);
    }

    #[test]
    fn test_error_event_serialization() {
        let event = ServerEvent::Error {
            message: "Test error".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("error"));
        assert!(json.contains("Test error"));
    }
}
