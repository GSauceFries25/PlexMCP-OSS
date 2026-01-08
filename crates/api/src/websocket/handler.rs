//! WebSocket handler for Axum
//!
//! Handles WebSocket connections, authentication, and event routing.

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::Response,
};
use futures::{stream::StreamExt, SinkExt};
use serde::Deserialize;
use sqlx::PgPool;
use std::sync::Arc;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::state::AppState;

use super::{
    connection::Connection,
    events::{ClientEvent, ServerEvent, TicketViewer, UserPresence},
    state::WebSocketState,
};

#[derive(Debug, Deserialize)]
pub struct WebSocketQuery {
    token: String,
}

/// WebSocket handler - upgrades HTTP connection to WebSocket
/// Authenticates via query parameter token instead of middleware Extension
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(app_state): State<AppState>,
    Query(params): Query<WebSocketQuery>,
) -> Result<Response, StatusCode> {
    // Validate JWT token from query parameter
    let auth_state = app_state.auth_state();
    let token = &params.token;

    // Try to validate as PlexMCP-issued token first
    let user_id = match auth_state.jwt_manager.validate_access_token(token) {
        Ok(claims) => {
            // Verify user exists in database
            match sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
                .bind(claims.sub)
                .fetch_one(&app_state.pool)
                .await
            {
                Ok(true) => claims.sub,
                Ok(false) => {
                    tracing::warn!(user_id = %claims.sub, "WebSocket auth failed: user not found");
                    return Err(StatusCode::UNAUTHORIZED);
                }
                Err(e) => {
                    tracing::error!(error = ?e, "WebSocket auth: database error");
                    return Err(StatusCode::INTERNAL_SERVER_ERROR);
                }
            }
        }
        Err(e) => {
            // PlexMCP token validation failed, try Supabase token
            tracing::info!(error = ?e, "PlexMCP token validation failed, trying Supabase");

            // Try to verify as Supabase token via API call
            let auth_user = match crate::auth::middleware::verify_supabase_auth_from_app_state(&app_state, token).await {
                Ok(user) => user,
                Err(auth_err) => {
                    tracing::warn!(error = ?auth_err, "WebSocket auth failed: invalid token");
                    return Err(StatusCode::UNAUTHORIZED);
                }
            };

            // Extract user_id from authenticated user
            match auth_user.user_id {
                Some(uid) => uid,
                None => {
                    tracing::warn!("WebSocket auth failed: no user_id in authenticated user");
                    return Err(StatusCode::UNAUTHORIZED);
                }
            }
        }
    };

    tracing::info!(user_id = %user_id, "WebSocket connection upgrade requested");

    // Upgrade the connection
    Ok(ws.on_upgrade(move |socket| handle_socket(socket, user_id, app_state)))
}

/// Handle individual WebSocket connection
async fn handle_socket(socket: WebSocket, user_id: Uuid, app_state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    // Create channel for sending events to this connection
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerEvent>();

    // Create connection
    let conn = Connection::new(user_id, tx);
    let ws_state = app_state.ws_state.clone();
    let conn = ws_state.add_connection(conn).await;
    let session_id = conn.session_id;

    // Send connection acknowledgment
    let _ = conn.send(ServerEvent::Connected { session_id });

    // Update user presence to online
    if let Err(e) = update_user_presence(&app_state.pool, user_id, "online").await {
        tracing::error!(error = ?e, user_id = %user_id, "Failed to update user presence");
    }

    // Send initial presence batch to newly connected client
    match get_all_user_presence(&app_state.pool).await {
        Ok(presence_list) => {
            let _ = conn.send(ServerEvent::PresenceBatch {
                users: presence_list,
            });
        }
        Err(e) => {
            tracing::error!(error = ?e, "Failed to fetch presence batch");
        }
    }

    // Broadcast presence update to all other clients
    broadcast_presence_to_all(
        &ws_state,
        user_id,
        "online",
        None,
    )
    .await;

    // Spawn task to send messages to client
    let send_task = tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            // Serialize and send event
            match serde_json::to_string(&event) {
                Ok(json) => {
                    if sender.send(Message::Text(json)).await.is_err() {
                        break; // Connection closed
                    }
                }
                Err(e) => {
                    tracing::error!(error = ?e, "Failed to serialize WebSocket event");
                }
            }
        }
    });

    // Handle incoming messages
    let ws_state_clone = ws_state.clone();
    let app_state_clone = app_state.clone();
    while let Some(msg) = receiver.next().await {
        if let Ok(msg) = msg {
            match msg {
                Message::Text(text) => {
                    // Parse client event
                    match serde_json::from_str::<ClientEvent>(&text) {
                        Ok(event) => {
                            handle_client_event(
                                event,
                                Arc::clone(&conn),
                                ws_state_clone.clone(),
                                app_state_clone.clone(),
                            )
                            .await;
                        }
                        Err(e) => {
                            tracing::warn!(
                                error = ?e,
                                message = %text,
                                "Failed to parse client event"
                            );
                            let _ = conn.send(ServerEvent::Error {
                                message: "Invalid event format".to_string(),
                            });
                        }
                    }
                }
                Message::Close(_) => {
                    tracing::info!(session_id = %session_id, "WebSocket close frame received");
                    break;
                }
                Message::Ping(_) | Message::Pong(_) => {
                    // Axum handles ping/pong automatically
                }
                _ => {} // Ignore binary messages
            }
        }
    }

    // Cleanup on disconnect
    tracing::info!(session_id = %session_id, user_id = %user_id, "WebSocket connection closing");
    ws_state.remove_connection(&session_id).await;

    if let Err(e) = update_user_presence(&app_state.pool, user_id, "offline").await {
        tracing::error!(error = ?e, user_id = %user_id, "Failed to update user presence on disconnect");
    }

    // Broadcast offline status to all clients
    broadcast_presence_to_all(&ws_state, user_id, "offline", None).await;

    send_task.abort();
}

/// Handle client event
async fn handle_client_event(
    event: ClientEvent,
    conn: Arc<Connection>,
    ws_state: WebSocketState,
    app_state: AppState,
) {
    use ClientEvent::*;

    match event {
        Subscribe { ticket_id } => {
            // Verify user has access to this ticket
            match verify_ticket_access(&app_state.pool, conn.user_id, ticket_id).await {
                Ok(true) => {
                    conn.subscribe(ticket_id).await;
                    ws_state.rooms.join(ticket_id, Arc::clone(&conn)).await;
                    tracing::debug!(
                        session_id = %conn.session_id,
                        ticket_id = %ticket_id,
                        "Subscribed to ticket"
                    );
                }
                Ok(false) => {
                    let _ = conn.send(ServerEvent::Error {
                        message: "Access denied to ticket".to_string(),
                    });
                }
                Err(e) => {
                    tracing::error!(error = ?e, "Failed to verify ticket access");
                    let _ = conn.send(ServerEvent::Error {
                        message: "Failed to verify access".to_string(),
                    });
                }
            }
        }

        Unsubscribe { ticket_id } => {
            conn.unsubscribe(ticket_id).await;
            ws_state.rooms.leave(&ticket_id, &conn.session_id).await;
        }

        TypingStart { ticket_id } => {
            // Update database
            if let Err(e) = set_typing_indicator(&app_state.pool, ticket_id, conn.user_id, true).await {
                tracing::error!(error = ?e, "Failed to set typing indicator");
                return;
            }

            // Broadcast to other viewers
            let user_name = get_user_name(&app_state.pool, conn.user_id).await;
            ws_state
                .rooms
                .broadcast(
                    &ticket_id,
                    ServerEvent::UserTypingStart {
                        ticket_id,
                        user_id: conn.user_id,
                        user_name,
                    },
                )
                .await;
        }

        TypingStop { ticket_id } => {
            // Remove from database
            if let Err(e) = set_typing_indicator(&app_state.pool, ticket_id, conn.user_id, false).await {
                tracing::error!(error = ?e, "Failed to remove typing indicator");
                return;
            }

            // Broadcast to other viewers
            ws_state
                .rooms
                .broadcast(
                    &ticket_id,
                    ServerEvent::UserTypingStop {
                        ticket_id,
                        user_id: conn.user_id,
                    },
                )
                .await;
        }

        JoinTicketView { ticket_id } => {
            if let Err(e) = add_ticket_viewer(&app_state.pool, ticket_id, conn.user_id).await {
                tracing::error!(error = ?e, "Failed to add ticket viewer");
                return;
            }

            // Broadcast updated viewers list
            match get_ticket_viewers(&app_state.pool, ticket_id).await {
                Ok(viewers) => {
                    ws_state
                        .rooms
                        .broadcast(&ticket_id, ServerEvent::ViewersUpdate { ticket_id, viewers })
                        .await;
                }
                Err(e) => {
                    tracing::error!(error = ?e, "Failed to fetch ticket viewers");
                }
            }
        }

        LeaveTicketView { ticket_id } => {
            if let Err(e) = remove_ticket_viewer(&app_state.pool, ticket_id, conn.user_id).await {
                tracing::error!(error = ?e, "Failed to remove ticket viewer");
                return;
            }

            // Broadcast updated viewers list
            match get_ticket_viewers(&app_state.pool, ticket_id).await {
                Ok(viewers) => {
                    ws_state
                        .rooms
                        .broadcast(&ticket_id, ServerEvent::ViewersUpdate { ticket_id, viewers })
                        .await;
                }
                Err(e) => {
                    tracing::error!(error = ?e, "Failed to fetch ticket viewers");
                }
            }
        }

        Ping => {
            let _ = conn.send(ServerEvent::Pong);
            if let Err(e) = update_user_presence(&app_state.pool, conn.user_id, "online").await {
                tracing::error!(error = ?e, "Failed to update presence on ping");
            }
        }

        SetPresence { status } => {
            // Validate status value
            if !["online", "away", "offline"].contains(&status.as_str()) {
                let _ = conn.send(ServerEvent::Error {
                    message: "Invalid status. Must be online, away, or offline".to_string(),
                });
                return;
            }

            // Update database
            if let Err(e) = update_user_presence(&app_state.pool, conn.user_id, &status).await {
                tracing::error!(error = ?e, user_id = %conn.user_id, status = %status, "Failed to update presence");
                let _ = conn.send(ServerEvent::Error {
                    message: "Failed to update presence status".to_string(),
                });
                return;
            }

            // Broadcast to all clients
            broadcast_presence_to_all(
                &ws_state,
                conn.user_id,
                &status,
                None,
            )
            .await;

            tracing::info!(user_id = %conn.user_id, status = %status, "User presence updated");
        }
    }
}

// =============================================================================
// Database Helper Functions
// =============================================================================

/// Verify user has access to a ticket
async fn verify_ticket_access(pool: &PgPool, user_id: Uuid, ticket_id: Uuid) -> Result<bool, sqlx::Error> {
    let has_access = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
          SELECT 1 FROM support_tickets t
          WHERE t.id = $1
            AND (
              -- User belongs to ticket's organization
              t.organization_id IN (SELECT org_id FROM users WHERE id = $2)
              -- Or user is platform admin/staff
              OR EXISTS(
                SELECT 1 FROM users
                WHERE id = $2
                AND platform_role IN ('admin', 'superadmin', 'staff')
              )
            )
        )
        "#,
    )
    .bind(ticket_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(has_access)
}

/// Update user presence status
async fn update_user_presence(pool: &PgPool, user_id: Uuid, status: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO user_presence (user_id, online_status, last_activity_at, last_seen_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          online_status = $2,
          last_activity_at = NOW(),
          last_seen_at = NOW(),
          updated_at = NOW()
        "#,
    )
    .bind(user_id)
    .bind(status)
    .execute(pool)
    .await?;

    Ok(())
}

/// Set or remove typing indicator
async fn set_typing_indicator(
    pool: &PgPool,
    ticket_id: Uuid,
    user_id: Uuid,
    is_typing: bool,
) -> Result<(), sqlx::Error> {
    if is_typing {
        sqlx::query(
            r#"
            INSERT INTO ticket_typing_indicators (ticket_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT (ticket_id, user_id) DO UPDATE SET
              last_update_at = NOW()
            "#,
        )
        .bind(ticket_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    } else {
        sqlx::query("DELETE FROM ticket_typing_indicators WHERE ticket_id = $1 AND user_id = $2")
            .bind(ticket_id)
            .bind(user_id)
            .execute(pool)
            .await?;
    }

    Ok(())
}

/// Add user as ticket viewer
async fn add_ticket_viewer(pool: &PgPool, ticket_id: Uuid, user_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO ticket_viewers (ticket_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT (ticket_id, user_id) DO UPDATE SET
          last_ping_at = NOW()
        "#,
    )
    .bind(ticket_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Remove user from ticket viewers
async fn remove_ticket_viewer(pool: &PgPool, ticket_id: Uuid, user_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM ticket_viewers WHERE ticket_id = $1 AND user_id = $2")
        .bind(ticket_id)
        .bind(user_id)
        .execute(pool)
        .await?;

    Ok(())
}

/// Get user display name
async fn get_user_name(pool: &PgPool, user_id: Uuid) -> String {
    sqlx::query_scalar::<_, String>("SELECT COALESCE(email, 'Unknown') FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|_| "Unknown".to_string())
}

/// Get all viewers for a ticket
async fn get_ticket_viewers(pool: &PgPool, ticket_id: Uuid) -> Result<Vec<TicketViewer>, sqlx::Error> {
    #[derive(sqlx::FromRow)]
    struct ViewerRow {
        user_id: Uuid,
        user_email: String,
        started_viewing_at: time::OffsetDateTime,
    }

    let rows = sqlx::query_as::<_, ViewerRow>(
        r#"
        SELECT v.user_id, u.email as user_email, v.started_viewing_at
        FROM ticket_viewers v
        JOIN users u ON u.id = v.user_id
        WHERE v.ticket_id = $1
        ORDER BY v.started_viewing_at ASC
        "#,
    )
    .bind(ticket_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| TicketViewer {
            user_id: r.user_id,
            user_name: r.user_email.clone(),
            user_email: r.user_email,
            started_viewing_at: r.started_viewing_at,
        })
        .collect())
}

/// Get all user presence data
async fn get_all_user_presence(pool: &PgPool) -> Result<Vec<UserPresence>, sqlx::Error> {
    #[derive(sqlx::FromRow)]
    struct PresenceRow {
        user_id: Uuid,
        online_status: String,
        last_activity_at: time::OffsetDateTime,
    }

    let rows = sqlx::query_as::<_, PresenceRow>(
        r#"
        SELECT user_id, online_status, last_activity_at
        FROM user_presence
        WHERE online_status IN ('online', 'away')
        ORDER BY last_activity_at DESC
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| UserPresence {
            user_id: r.user_id,
            online_status: r.online_status,
            last_activity_at: r.last_activity_at.to_string(),
        })
        .collect())
}

/// Broadcast presence update to all connected clients
async fn broadcast_presence_to_all(
    ws_state: &WebSocketState,
    user_id: Uuid,
    status: &str,
    last_activity_at: Option<String>,
) {
    let event = ServerEvent::PresenceUpdate {
        user_id,
        online_status: status.to_string(),
        last_activity_at,
    };

    // Broadcast to all connections
    let connections = ws_state.connections.read().await;
    for conn in connections.values() {
        let _ = conn.send(event.clone());
    }
}
