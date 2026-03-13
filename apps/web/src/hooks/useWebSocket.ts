import { useEffect, useRef, useState } from 'react';

export interface WSMessage {
  type: string;
  channel: string;
  data: any;
}

export function useWebSocket(channelId: string | null) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnect = useRef(true);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);

  useEffect(() => {
    if (!channelId) return;

    shouldReconnect.current = true;

    function connect() {
      if (!shouldReconnect.current) return;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws?channel=${channelId}`;

      try {
        const socket = new WebSocket(url);

        socket.onopen = () => {
          setConnected(true);
          if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current);
            reconnectTimer.current = null;
          }
        };

        socket.onclose = () => {
          setConnected(false);
          if (shouldReconnect.current) {
            reconnectTimer.current = setTimeout(connect, 3000);
          }
        };

        socket.onerror = () => {
          // onclose will fire after onerror, handles reconnect
          socket.close();
        };

        socket.onmessage = (e) => {
          try {
            setLastMessage(JSON.parse(e.data));
          } catch {
            // ignore malformed messages
          }
        };

        ws.current = socket;
      } catch {
        // WebSocket constructor can throw; schedule reconnect
        if (shouldReconnect.current) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      }
    }

    connect();

    return () => {
      shouldReconnect.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      ws.current?.close();
      ws.current = null;
    };
  }, [channelId]);

  return { connected, lastMessage };
}
