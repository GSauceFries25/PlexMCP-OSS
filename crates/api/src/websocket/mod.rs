//! WebSocket support for real-time features
//!
//! Provides WebSocket infrastructure for support ticket real-time updates including:
//! - User presence tracking (online/offline/away)
//! - Ticket viewer tracking (who's viewing which tickets)
//! - Typing indicators (who's typing in which tickets)
//! - Real-time message delivery
//!
//! # Architecture
//!
//! - **Connection**: Represents an authenticated WebSocket connection
//! - **Room**: Ticket-based pub/sub for broadcasting events
//! - **State**: Global WebSocket state shared across all connections
//! - **Handler**: Axum WebSocket route handler
//! - **Events**: Type-safe event definitions for client/server communication

pub mod connection;
pub mod events;
pub mod handler;
pub mod room;
pub mod state;

pub use handler::ws_handler;
pub use state::WebSocketState;
