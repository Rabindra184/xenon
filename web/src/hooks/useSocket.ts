import { useEffect, useState, useCallback } from 'react';
import { getSharedSocket, subscribeToEvent } from './socket-manager';

/**
 * Access the app-wide socket. Every consumer shares a single connection (see
 * socket-manager); this hook only tracks local connection state and exposes a
 * stable `on()` for event subscriptions.
 */
export const useSocket = () => {
  // Lazy initial state: getSharedSocket() runs once per mount but is idempotent,
  // so all consumers receive the same singleton.
  const [socket] = useState(getSharedSocket);
  const [isConnected, setIsConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    // Sync in case we connected between render and effect.
    setIsConnected(socket.connected);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  const on = useCallback(
    (event: string, callback: (data: any) => void) => subscribeToEvent(event, callback),
    [],
  );

  return { socket, isConnected, on };
};
