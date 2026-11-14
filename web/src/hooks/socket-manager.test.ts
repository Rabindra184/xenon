import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake socket that records handlers so tests can drive connect / broadcasts.
const handlers: Record<string, (...args: any[]) => void> = {};
let anyHandler: ((event: string, data: any) => void) | null = null;
const emit = vi.fn();
const close = vi.fn();
const connect = vi.fn();
const fakeSocket = {
  connected: false,
  active: true,
  on: (event: string, cb: (...args: any[]) => void) => {
    handlers[event] = cb;
  },
  onAny: (cb: (event: string, data: any) => void) => {
    anyHandler = cb;
  },
  emit,
  close,
  connect,
};
const ioMock = vi.fn((..._args: any[]) => fakeSocket);

vi.mock('socket.io-client', () => ({ io: (...args: any[]) => ioMock(...args) }));

import {
  __resetSocketManagerForTests,
  getSharedSocket,
  onSocketRefused,
  reviveSharedSocket,
  subscribeToEvent,
} from './socket-manager';

beforeEach(() => {
  ioMock.mockClear();
  emit.mockClear();
  connect.mockClear();
  fakeSocket.active = true;
  for (const k of Object.keys(handlers)) delete handlers[k];
  anyHandler = null;
});

afterEach(() => __resetSocketManagerForTests());

describe('socket-manager — single shared connection (F4)', () => {
  it('creates exactly one socket no matter how many consumers ask for it', () => {
    const a = getSharedSocket();
    const b = getSharedSocket();
    const c = getSharedSocket();
    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('registers the dashboard exactly once on connect', () => {
    getSharedSocket();
    handlers['connect']?.();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('register_dashboard');
  });
});

describe('socket-manager — event registry', () => {
  it('dispatches a broadcast to every subscriber of that event', () => {
    getSharedSocket();
    const a = vi.fn();
    const b = vi.fn();
    subscribeToEvent('device:update', a);
    subscribeToEvent('device:update', b);

    anyHandler?.('device:update', { udid: 'u1' });

    expect(a).toHaveBeenCalledWith({ udid: 'u1' });
    expect(b).toHaveBeenCalledWith({ udid: 'u1' });
  });

  it('stops delivering after unsubscribe, without disturbing other subscribers', () => {
    getSharedSocket();
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeToEvent('evt', a);
    subscribeToEvent('evt', b);

    offA();
    anyHandler?.('evt', 1);

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(1);
  });

  it('ignores events with no subscribers', () => {
    getSharedSocket();
    expect(() => anyHandler?.('nobody:listening', {})).not.toThrow();
  });
});

// The server closes a socket whose sign-in it no longer accepts (signed out,
// disabled, a revoked key) and refuses its reconnect. socket.io's client
// doesn't try again after a refused handshake: `active` is false. After a
// network failure it is still true, and it retries by itself.
describe('socket-manager — a refused socket', () => {
  it('tells its listeners when the handshake is refused, and not when a reconnect merely failed', () => {
    getSharedSocket();
    const refused = vi.fn();
    onSocketRefused(refused);

    handlers['connect_error']?.(new Error('websocket error'));
    expect(refused).not.toHaveBeenCalled();

    fakeSocket.active = false;
    handlers['connect_error']?.(new Error('unauthorized'));
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it('stops telling a listener once it unsubscribes', () => {
    getSharedSocket();
    const refused = vi.fn();
    const off = onSocketRefused(refused);
    off();
    fakeSocket.active = false;
    handlers['connect_error']?.(new Error('unauthorized'));
    expect(refused).not.toHaveBeenCalled();
  });

  it('revives a refused socket, and leaves alone one that is live or reconnecting by itself', () => {
    reviveSharedSocket();
    expect(ioMock, 'no socket is made by reviving').not.toHaveBeenCalled();

    getSharedSocket();
    reviveSharedSocket();
    expect(connect).not.toHaveBeenCalled();

    fakeSocket.active = false;
    reviveSharedSocket();
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

// The server answers `unavailable` when it could not check the sign-in now
// (its database unavailable), and `unauthorized` when it doesn't accept it.
// socket.io leaves the socket inactive after either. Through 2.36 both were
// `unauthorized`, and a dashboard reconnecting during a database hiccup had no
// live events until a reload.
describe('socket-manager — a handshake the server could not check', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tries again by itself, waiting longer each time, and tells no listener', () => {
    getSharedSocket();
    const refused = vi.fn();
    onSocketRefused(refused);

    fakeSocket.active = false;
    handlers['connect_error']?.(new Error('unavailable'));
    expect(refused).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(connect).toHaveBeenCalledTimes(1);

    // Still unavailable: the next try waits twice as long.
    handlers['connect_error']?.(new Error('unavailable'));
    vi.advanceTimersByTime(1_999);
    expect(connect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(refused).not.toHaveBeenCalled();
  });

  it('starts from the shortest wait again once connected', () => {
    getSharedSocket();
    fakeSocket.active = false;
    handlers['connect_error']?.(new Error('unavailable'));
    vi.advanceTimersByTime(1_000);
    handlers['connect_error']?.(new Error('unavailable'));
    vi.advanceTimersByTime(2_000);
    expect(connect).toHaveBeenCalledTimes(2);

    fakeSocket.active = true;
    handlers['connect']?.();
    fakeSocket.active = false;
    handlers['connect_error']?.(new Error('unavailable'));
    vi.advanceTimersByTime(1_000);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('makes no try of its own for a socket that is already reconnecting or connected', () => {
    getSharedSocket();
    fakeSocket.active = false;
    handlers['connect_error']?.(new Error('unavailable'));
    // Revived meanwhile (a sign-in), so active again.
    fakeSocket.active = true;
    vi.advanceTimersByTime(30_000);
    expect(connect).not.toHaveBeenCalled();
  });

  it('still tells its listeners about a refusal, and stops trying', () => {
    getSharedSocket();
    const refused = vi.fn();
    onSocketRefused(refused);
    fakeSocket.active = false;
    handlers['connect_error']?.(new Error('unavailable'));
    handlers['connect_error']?.(new Error('unauthorized'));
    expect(refused).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(connect).not.toHaveBeenCalled();
  });
});
