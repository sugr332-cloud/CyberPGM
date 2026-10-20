import { useEffect, useRef, useState, useCallback } from 'react';

export interface UseWebSocketOptions {
  token?: string | null;
  sessionCode?: string | null;
  onMessage?: (type: string, payload: unknown) => void;
}

export function useWebSocket({ token, sessionCode, onMessage }: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const onMessageRef = useRef(onMessage);

  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!token && !sessionCode) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
      setIsReconnecting(false);
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = token
      ? `token=${encodeURIComponent(token)}`
      : `code=${encodeURIComponent(sessionCode || '')}`;
    const wsUrl = `${proto}//${window.location.host}/ws?${query}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setIsReconnecting(false);
        reconnectAttempts.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.type && onMessageRef.current) {
            onMessageRef.current(data.type, data.payload);
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        wsRef.current = null;

        // If not closed normally, attempt exponential backoff reconnect
        if (event.code !== 1000 && event.code !== 1008) {
          setIsReconnecting(true);
          const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts.current), 10000);
          reconnectAttempts.current += 1;
          reconnectTimeout.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        // ws.onclose will be called after error
      };
    } catch {
      setIsReconnecting(true);
      const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts.current), 10000);
      reconnectAttempts.current += 1;
      reconnectTimeout.current = setTimeout(connect, delay);
    }
  }, [token]);

  useEffect(() => {
    connect();

    // Heartbeat ping every 25 seconds
    const pingInterval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);

    return () => {
      clearInterval(pingInterval);
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
        wsRef.current = null;
      }
    };
  }, [connect]);

  const sendMessage = useCallback((data: object) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);

  return { isConnected, isReconnecting, sendMessage };
}
