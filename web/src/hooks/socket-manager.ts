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
const refusedListeners = new Set<() => void>();

/**
 * Where the shared socket stands, for the header's pill. `reconnecting`
 * covers socket.io's own retries and Xenon's after an `unavailable`
 * handshake; `refused` is a refused handshake, which nothing tries again
 * until `reviveSharedSocket` (a sign-in) or a reload.
 */
export type SocketPhase = 'connecting' | 'live' | 'reconnecting' | 'refused';
let phase: SocketPhase = 'connecting';
let everConnected = false;
const phaseListeners = new Set<(phase: SocketPhase) => void>();

function setPhase(next: SocketPhase): void {
  if (phase === next) return;
  phase = next;
  Array.from(phaseListeners).forEach((cb) => cb(next));
}

/** Trying again: `connecting` before the first connection, `reconnecting` after. */
function tryingAgain(): SocketPhase {
  return everConnected ? 'reconnecting' : 'connecting';
}

/** The server's answer to a handshake it could not check now (its database unavailable). */
const HANDSHAKE_UNAVAILABLE = 'unavailable';
/** The first wait before such a handshake is tried again; it doubles from there. */
const RETRY_DELAY_MS = 1_000;
/** The longest wait between those tries. */
const RETRY_DELAY_MAX_MS = 30_000;
let retryDelay = RETRY_DELAY_MS;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function stopRetrying(): void {
  clearTimeout(retryTimer);
  retryTimer = undefined;
}

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
    stopRetrying();
    retryDelay = RETRY_DELAY_MS;
    everConnected = true;
    setPhase('live');
    console.log('[Socket] Connected to Hub');
    socket.emit('register_dashboard');
  });
  socket.on('disconnect', () => {
    setPhase(tryingAgain());
    console.log('[Socket] Disconnected from Hub');
  });
  // The server closes the connection of a sign-in it no longer accepts
  // (signed out elsewhere, disabled, a revoked key), and refuses the
  // reconnect. A refusal, unlike a network failure, leaves the socket
  // inactive: socket.io doesn't try again.
  //
  // A handshake the server could not check now (`unavailable`: its database
  // or signing key unavailable) leaves it inactive too, but says nothing about
  // the sign-in, so it is tried again here, waiting longer each time, and no
  // listener is told. Through 2.36 the server answered it as a refusal.
  socket.on('connect_error', (err?: Error) => {
    if (socket.active) return;
    if (err?.message === HANDSHAKE_UNAVAILABLE) {
      setPhase(tryingAgain());
      const delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, RETRY_DELAY_MAX_MS);
      stopRetrying();
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (sharedSocket === socket && !socket.active) socket.connect();
      }, delay);
      return;
    }
    stopRetrying();
    retryDelay = RETRY_DELAY_MS;
    setPhase('refused');
    Array.from(refusedListeners).forEach((cb) => cb());
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

/**
 * Called whenever the server refuses the shared socket's handshake, after
 * which socket.io doesn't try again. Returns an unsubscribe function.
 */
export function onSocketRefused(callback: () => void): () => void {
  refusedListeners.add(callback);
  return () => {
    refusedListeners.delete(callback);
  };
}

/**
 * Connects the shared socket again if its handshake was refused, which
 * socket.io doesn't retry. The handshake then decides on the sign-in the
 * browser has now. Does nothing to a socket that is connected or
 * reconnecting by itself, or before one exists.
 */
export function reviveSharedSocket(): void {
  if (!sharedSocket || sharedSocket.active) return;
  setPhase(tryingAgain());
  sharedSocket.connect();
}

/** The shared socket's phase now. */
export function getSocketPhase(): SocketPhase {
  return phase;
}

/** Called whenever the shared socket's phase changes. Returns an unsubscribe function. */
export function onSocketPhase(callback: (phase: SocketPhase) => void): () => void {
  phaseListeners.add(callback);
  return () => {
    phaseListeners.delete(callback);
  };
}

/** Test-only: tear down the singleton and clear all listeners. */
export function __resetSocketManagerForTests(): void {
  stopRetrying();
  retryDelay = RETRY_DELAY_MS;
  if (sharedSocket) {
    try {
      sharedSocket.close();
    } catch {
      /* noop */
    }
  }
  sharedSocket = null;
  listeners.clear();
  refusedListeners.clear();
  phase = 'connecting';
  everConnected = false;
  phaseListeners.clear();
}
