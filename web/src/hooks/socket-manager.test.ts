import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake socket that records handlers so tests can drive connect / broadcasts.
const handlers: Record<string, (...args: any[]) => void> = {};
let anyHandler: ((event: string, data: any) => void) | null = null;
const emit = vi.fn();
const close = vi.fn();
const fakeSocket = {
  connected: false,
  on: (event: string, cb: (...args: any[]) => void) => {
    handlers[event] = cb;
  },
  onAny: (cb: (event: string, data: any) => void) => {
    anyHandler = cb;
  },
  emit,
  close,
};
const ioMock = vi.fn((..._args: any[]) => fakeSocket);

vi.mock('socket.io-client', () => ({ io: (...args: any[]) => ioMock(...args) }));

import {
  __resetSocketManagerForTests,
  getSharedSocket,
  subscribeToEvent,
} from './socket-manager';

beforeEach(() => {
  ioMock.mockClear();
  emit.mockClear();
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
