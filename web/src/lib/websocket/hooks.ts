/**
 * React hooks for WebSocket real-time features
 *
 * Provides hooks for WebSocket connection management,
 * ticket subscriptions, typing indicators, and viewers.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { WebSocketManager, WebSocketStatus, ServerEvent } from './manager';

// =============================================================================
// WebSocket Context (to be used with Context API)
// =============================================================================

let globalWebSocket: WebSocketManager | null = null;

export function getWebSocketManager(token?: string): WebSocketManager | null {
  if (!globalWebSocket && token) {
    // Determine WebSocket URL based on environment
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use the API URL from environment or construct from window location
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    let wsUrl: string;

    if (apiUrl) {
      // Use the configured API URL from NEXT_PUBLIC_API_URL
      const host = apiUrl.replace(/^https?:\/\//, '');
      wsUrl = `${protocol}//${host}/api/v1/ws/support`;
    } else {
      // Fallback to same host (development)
      wsUrl = `${protocol}//${window.location.host}/api/v1/ws/support`;
    }

    console.log('[WebSocket] Connecting to:', wsUrl);

    globalWebSocket = new WebSocketManager({
      url: wsUrl,
      token,
    });
  }

  return globalWebSocket;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Main WebSocket connection hook
 *
 * Manages the global WebSocket connection and returns connection status
 */
export function useWebSocket(token?: string) {
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const wsRef = useRef<WebSocketManager | null>(null);

  useEffect(() => {
    if (!token) {
      console.warn('[WebSocket Hook] No token provided, cannot connect');
      return;
    }

    console.log('[WebSocket Hook] Token provided, attempting to get/create WebSocket manager');
    const ws = getWebSocketManager(token);
    if (!ws) {
      console.error('[WebSocket Hook] Failed to get WebSocket manager');
      return;
    }

    wsRef.current = ws;

    // Initialize state with current status if manager already exists
    const currentStatus = ws.getStatus();
    console.log('[WebSocket Hook] Current WebSocket status:', currentStatus);
    if (currentStatus !== 'disconnected') {
      setStatus(currentStatus);
    }

    const handleStatusChange = (newStatus: WebSocketStatus) => {
      console.log('[WebSocket Hook] Status changed to:', newStatus);
      setStatus(newStatus);
    };

    ws.on('statusChange', handleStatusChange);
    console.log('[WebSocket Hook] Calling connect()');
    ws.connect();

    return () => {
      ws.off('statusChange', handleStatusChange);
      // Note: Don't disconnect here as it's a global singleton
      // Only disconnect when user logs out or navigates away from app
    };
  }, [token]);

  return {
    status,
    manager: wsRef.current,
    subscribe: useCallback((ticketId: string) => {
      wsRef.current?.send({ type: 'subscribe', ticket_id: ticketId });
    }, []),
    unsubscribe: useCallback((ticketId: string) => {
      wsRef.current?.send({ type: 'unsubscribe', ticket_id: ticketId });
    }, []),
    startTyping: useCallback((ticketId: string) => {
      wsRef.current?.send({ type: 'typing_start', ticket_id: ticketId });
    }, []),
    stopTyping: useCallback((ticketId: string) => {
      wsRef.current?.send({ type: 'typing_stop', ticket_id: ticketId });
    }, []),
    joinView: useCallback((ticketId: string) => {
      wsRef.current?.send({ type: 'join_ticket_view', ticket_id: ticketId });
    }, []),
    leaveView: useCallback((ticketId: string) => {
      wsRef.current?.send({ type: 'leave_ticket_view', ticket_id: ticketId });
    }, []),
    setPresence: useCallback((status: 'online' | 'away' | 'offline') => {
      wsRef.current?.send({ type: 'set_presence', status });
    }, []),
  };
}

/**
 * Hook to listen for specific WebSocket events
 */
export function useWebSocketEvent<T = any>(
  eventType: string,
  handler: (data: T) => void,
  dependencies: any[] = []
) {
  const wsRef = useRef<WebSocketManager | null>(null);

  useEffect(() => {
    const ws = getWebSocketManager();
    if (!ws) return;

    wsRef.current = ws;

    const wrappedHandler = (event: ServerEvent) => {
      handler(event as T);
    };

    ws.on(eventType, wrappedHandler);

    return () => {
      ws.off(eventType, wrappedHandler);
    };
  }, [eventType, ...dependencies]);
}

/**
 * Hook to subscribe to a specific ticket's updates
 */
export function useTicketSubscription(ticketId: string | null) {
  useEffect(() => {
    if (!ticketId) return;

    // Use the global WebSocket manager directly
    const ws = getWebSocketManager();
    if (!ws) {
      console.warn('[WebSocket] Cannot subscribe - no WebSocket manager available');
      return;
    }

    // Function to send subscription
    const subscribe = () => {
      const status = ws.getStatus();
      if (status === 'connected') {
        ws.send({ type: 'subscribe', ticket_id: ticketId });
        console.log('[WebSocket] Subscribed to ticket:', ticketId);
      } else {
        console.log('[WebSocket] Waiting for connection to subscribe to ticket:', ticketId, 'Current status:', status);
      }
    };

    // Subscribe immediately if already connected
    subscribe();

    // Re-subscribe on reconnect (handles case where subscription runs before connection)
    const handleStatusChange = (newStatus: WebSocketStatus) => {
      console.log('[WebSocket] Status changed to:', newStatus, 'for ticket:', ticketId);
      if (newStatus === 'connected') {
        subscribe();
      }
    };

    ws.on('statusChange', handleStatusChange);

    return () => {
      ws.off('statusChange', handleStatusChange);
      // Only unsubscribe if connected
      if (ws.getStatus() === 'connected') {
        ws.send({ type: 'unsubscribe', ticket_id: ticketId });
        console.log('[WebSocket] Unsubscribed from ticket:', ticketId);
      }
    };
  }, [ticketId]);
}

/**
 * Hook for typing indicators with automatic stop after 3 seconds
 */
export function useTypingIndicator(ticketId: string | null) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

  const handleTyping = useCallback(() => {
    if (!ticketId) return;

    const ws = getWebSocketManager();
    if (!ws) return;

    // Start typing if not already
    if (!isTypingRef.current) {
      ws.send({ type: 'typing_start', ticket_id: ticketId });
      isTypingRef.current = true;
    }

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Auto-stop after 3 seconds of inactivity
    timeoutRef.current = setTimeout(() => {
      if (ticketId) {
        const ws = getWebSocketManager();
        if (ws) {
          ws.send({ type: 'typing_stop', ticket_id: ticketId });
          isTypingRef.current = false;
        }
      }
    }, 3000);
  }, [ticketId]);

  const handleStopTyping = useCallback(() => {
    if (!ticketId) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (isTypingRef.current) {
      const ws = getWebSocketManager();
      if (ws) {
        ws.send({ type: 'typing_stop', ticket_id: ticketId });
        isTypingRef.current = false;
      }
    }
  }, [ticketId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      handleStopTyping();
    };
  }, [handleStopTyping]);

  return {
    handleTyping,
    handleStopTyping,
  };
}

/**
 * Hook for tracking ticket viewers
 */
export function useTicketViewers(ticketId: string | null) {
  const [viewers, setViewers] = useState<any[]>([]);

  // Listen for viewers updates
  useWebSocketEvent('viewers_update', (data: any) => {
    if (data.ticket_id === ticketId) {
      setViewers(data.viewers || []);
    }
  }, [ticketId]);

  // Join/leave ticket view
  useEffect(() => {
    if (!ticketId) return;

    const ws = getWebSocketManager();
    if (!ws) return;

    // Function to join ticket view
    const joinView = () => {
      const status = ws.getStatus();
      if (status === 'connected') {
        ws.send({ type: 'join_ticket_view', ticket_id: ticketId });
        console.log('[WebSocket] Joined ticket view:', ticketId);
      }
    };

    // Join immediately if already connected
    joinView();

    // Re-join on reconnect
    const handleStatusChange = (newStatus: WebSocketStatus) => {
      if (newStatus === 'connected') {
        joinView();
      }
    };

    ws.on('statusChange', handleStatusChange);

    return () => {
      ws.off('statusChange', handleStatusChange);
      if (ws.getStatus() === 'connected') {
        ws.send({ type: 'leave_ticket_view', ticket_id: ticketId });
        console.log('[WebSocket] Left ticket view:', ticketId);
      }
    };
  }, [ticketId]);

  return viewers;
}

/**
 * Hook for tracking who's typing in a ticket
 */
export function useTypingUsers(ticketId: string | null) {
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());

  useWebSocketEvent('user_typing_start', (data: any) => {
    if (data.ticket_id === ticketId) {
      setTypingUsers((prev) => new Set(prev).add(data.user_name || data.user_id));
    }
  }, [ticketId]);

  useWebSocketEvent('user_typing_stop', (data: any) => {
    if (data.ticket_id === ticketId) {
      setTypingUsers((prev) => {
        const next = new Set(prev);
        next.delete(data.user_name || data.user_id);
        return next;
      });
    }
  }, [ticketId]);

  return Array.from(typingUsers);
}

/**
 * Hook to handle new message events
 */
export function useNewMessageHandler(
  ticketId: string | null,
  onNewMessage: (message: any) => void
) {
  useWebSocketEvent('new_message', (data: any) => {
    if (data.ticket_id === ticketId) {
      onNewMessage(data.message);
    }
  }, [ticketId, onNewMessage]);
}

/**
 * Hook to handle ticket update events
 */
export function useTicketUpdateHandler(
  ticketId: string | null,
  onTicketUpdate: (update: any) => void
) {
  useWebSocketEvent('ticket_updated', (data: any) => {
    if (data.ticket_id === ticketId) {
      onTicketUpdate(data);
    }
  }, [ticketId, onTicketUpdate]);
}

/**
 * Hook to track online/offline status of users
 * Returns a map of user_id -> presence status
 */
export function usePresenceTracking() {
  const [presenceMap, setPresenceMap] = useState<Record<string, {
    online_status: 'online' | 'away' | 'offline';
    last_activity_at: string;
  }>>({});

  useWebSocketEvent('presence_update', (data: any) => {
    if (data.user_id && data.online_status) {
      setPresenceMap((prev) => ({
        ...prev,
        [data.user_id]: {
          online_status: data.online_status,
          last_activity_at: data.last_activity_at || new Date().toISOString(),
        },
      }));
    }
  }, []);

  useWebSocketEvent('presence_batch', (data: any) => {
    if (data.users && Array.isArray(data.users)) {
      const newMap: Record<string, any> = {};
      data.users.forEach((user: any) => {
        newMap[user.user_id] = {
          online_status: user.online_status,
          last_activity_at: user.last_activity_at,
        };
      });
      setPresenceMap((prev) => ({ ...prev, ...newMap }));
    }
  }, []);

  return presenceMap;
}

/**
 * Hook to get presence status for a specific user
 */
export function useUserPresence(userId: string | null) {
  const presenceMap = usePresenceTracking();

  if (!userId) return null;
  return presenceMap[userId] || null;
}

/**
 * Cleanup global WebSocket connection
 * Call this on logout or app unmount
 */
export function disconnectWebSocket(): void {
  if (globalWebSocket) {
    globalWebSocket.disconnect();
    globalWebSocket = null;
  }
}
