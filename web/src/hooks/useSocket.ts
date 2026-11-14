import { useEffect, useState, useCallback } from 'react';
import {
  getSharedSocket,
  getSocketPhase,
  onSocketPhase,
  subscribeToEvent,
  type SocketPhase,
} from './socket-manager';

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

/**
 * The shared socket's phase (see socket-manager). React 17 has no
 * useSyncExternalStore, so it is read once, then followed.
 */
export const useSocketPhase = (): SocketPhase => {
  const [phase, setPhase] = useState(getSocketPhase);
  useEffect(() => {
    // Sync in case it changed between render and effect.
    setPhase(getSocketPhase());
    return onSocketPhase(setPhase);
  }, []);
  return phase;
};
