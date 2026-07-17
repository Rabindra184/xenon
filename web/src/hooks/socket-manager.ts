// One shared socket.io connection for the whole dashboard.
//
// Previously useSocket() called io() inside every consumer's effect, so each of
// the ~7 components that used it opened its own connection — each logging
// "Connected to Hub", each emitting register_dashboard, and every route change
// tearing them down and opening new ones (connect/disconnect churn, a new
// session id per navigation). This module owns a single lazily-created socket
// and a shared event registry that all consumers subscribe through.

import { io, Socket } from 'socket.io-client';

let sharedSocket: Socket | null = null;
const listeners = new Map<string, Set<(data: any) => void>>();

function dispatch(event: string, data: any): void {
  const set = listeners.get(event);
  if (!set) return;
  // Copy so a listener that unsubscribes mid-dispatch can't mutate the set we're iterating.
  Array.from(set).forEach((cb) => cb(data));
}

/** Lazily create (once) and return the app-wide socket. */
export function getSharedSocket(): Socket {
  if (sharedSocket) return sharedSocket;

  const socket = io(window.location.origin, {
    path: '/socket.io',
    reconnection: true,
    withCredentials: true,
  });

  socket.on('connect', () => {
    console.log('[Socket] Connected to Hub');
    socket.emit('register_dashboard');
  });
  socket.on('disconnect', () => {
    console.log('[Socket] Disconnected from Hub');
  });
  socket.onAny((event: string, data: any) => dispatch(event, data));

  sharedSocket = socket;
  return socket;
}

/**
 * Register a callback for a broadcast event on the shared socket.
 * Returns an unsubscribe function. Safe to call for the same event from many
 * consumers — each callback is dispatched once per event.
 */
export function subscribeToEvent(event: string, callback: (data: any) => void): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(callback);

  return () => {
    const current = listeners.get(event);
    if (!current) return;
    current.delete(callback);
    if (current.size === 0) listeners.delete(event);
  };
}

/** Test-only: tear down the singleton and clear all listeners. */
export function __resetSocketManagerForTests(): void {
  if (sharedSocket) {
    try {
      sharedSocket.close();
    } catch {
      /* noop */
    }
  }
  sharedSocket = null;
  listeners.clear();
}
