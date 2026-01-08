/**
 * WebSocket Manager for real-time support features
 *
 * Manages WebSocket connections with automatic reconnection,
 * heartbeat monitoring, and event-driven communication.
 */

import { EventEmitter } from 'events';

// =============================================================================
// Types
// =============================================================================

export type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface WebSocketConfig {
  url: string;
  token: string;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
}

export interface ServerEvent {
  type: string;
  [key: string]: any;
}

export interface ClientEvent {
  type: string;
  [key: string]: any;
}

// =============================================================================
// WebSocket Manager
// =============================================================================

export class WebSocketManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketConfig>;
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private status: WebSocketStatus = 'disconnected';
  private messageQueue: ClientEvent[] = [];

  constructor(config: WebSocketConfig) {
    super();
    this.config = {
      url: config.url,
      token: config.token,
      reconnectDelay: config.reconnectDelay ?? 1000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      heartbeatInterval: config.heartbeatInterval ?? 30000,
    };
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.warn('[WebSocket] Already connected');
      return;
    }

    this.setStatus('connecting');

    try {
      // Build WebSocket URL with token as query parameter
      const wsUrl = `${this.config.url}?token=${this.config.token}`;
      this.ws = new WebSocket(wsUrl);

      this.setupEventHandlers();
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      this.handleConnectionError();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.clearReconnectTimeout();
    this.clearHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setStatus('disconnected');
  }

  /**
   * Send event to server
   */
  send(event: ClientEvent): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(event));
      } catch (error) {
        console.error('[WebSocket] Send error:', error);
        // Queue message for retry
        this.messageQueue.push(event);
      }
    } else {
      // Queue message if not connected
      this.messageQueue.push(event);
    }
  }

  /**
   * Get current connection status
   */
  getStatus(): WebSocketStatus {
    return this.status;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('[WebSocket] Connected');
      this.setStatus('connected');
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.flushMessageQueue();
    };

    this.ws.onclose = (event) => {
      console.log('[WebSocket] Disconnected:', event.code, event.reason);
      this.clearHeartbeat();

      if (event.code !== 1000) {
        // Abnormal closure - attempt reconnect
        this.handleConnectionError();
      } else {
        this.setStatus('disconnected');
      }
    };

    this.ws.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
      this.emit('error', error);
    };

    this.ws.onmessage = (event) => {
      try {
        const serverEvent: ServerEvent = JSON.parse(event.data);
        this.handleServerEvent(serverEvent);
      } catch (error) {
        console.error('[WebSocket] Message parse error:', error);
      }
    };
  }

  private handleServerEvent(event: ServerEvent): void {
    console.log('[WebSocket] Received event:', event.type, event);

    // Emit specific event type
    this.emit(event.type, event);

    // Also emit a generic 'message' event
    this.emit('message', event);
  }

  private handleConnectionError(): void {
    this.clearHeartbeat();

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnect attempts reached');
      this.setStatus('disconnected');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.reconnectAttempts++;
    this.setStatus('reconnecting');

    // Exponential backoff
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    const jitter = Math.random() * 1000; // Add jitter to prevent thundering herd
    const totalDelay = Math.min(delay + jitter, 30000); // Cap at 30 seconds

    console.log(`[WebSocket] Reconnecting in ${totalDelay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, totalDelay);
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
      }
    }, this.config.heartbeatInterval);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private setStatus(status: WebSocketStatus): void {
    this.status = status;
    this.emit('statusChange', status);
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const event = this.messageQueue.shift();
      if (event) {
        this.send(event);
      }
    }
  }
}
