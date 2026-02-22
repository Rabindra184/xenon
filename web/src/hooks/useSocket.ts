import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export const useSocket = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const listeners = useRef<Map<string, ((data: any) => void)[]>>(new Map());

  useEffect(() => {
    // Determine the base URL for the socket connection
    // In production, it's the same host
    const socketUrl = window.location.origin;

    const newSocket = io(socketUrl, {
      path: '/socket.io',
      reconnection: true,
    });

    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('[Socket] Connected to Hub');
      setIsConnected(true);
      newSocket.emit('register_dashboard');
    });

    newSocket.on('disconnect', () => {
      console.log('[Socket] Disconnected from Hub');
      setIsConnected(false);
    });

    // Handle incoming events and dispatch to registered listeners
    const handleEvent = (event: string, data: any) => {
      const eventListeners = listeners.current.get(event);
      if (eventListeners) {
        eventListeners.forEach((callback: (data: any) => void) => callback(data));
      }
    };

    // Generic event listener for all registered events
    newSocket.onAny((event: string, data: any) => {
      handleEvent(event, data);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  const on = useCallback((event: string, callback: (data: any) => void) => {
    if (!listeners.current.has(event)) {
      listeners.current.set(event, []);
    }
    listeners.current.get(event)?.push(callback);

    return () => {
      const eventListeners = listeners.current.get(event);
      if (eventListeners) {
        listeners.current.set(
          event,
          eventListeners.filter((cb: (data: any) => void) => cb !== callback),
        );
      }
    };
  }, []);

  return { socket, isConnected, on };
};
