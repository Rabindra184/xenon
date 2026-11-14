import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// A fake socket that keeps every listener, as socket.io does: the manager and
// each useSocket consumer listen to the same events.
const fake = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...args: any[]) => void>>();
  const socket = {
    connected: false,
    active: true,
    on(event: string, cb: (...args: any[]) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(cb);
    },
    off(event: string, cb: (...args: any[]) => void) {
      handlers.get(event)?.delete(cb);
    },
    onAny() {},
    emit() {},
    close() {},
    connect: () => {
      socket.active = true;
    },
  };
  const fire = (event: string, ...args: any[]) =>
    Array.from(handlers.get(event) ?? []).forEach((cb) => cb(...args));
  return { handlers, socket, fire };
});

vi.mock('socket.io-client', () => ({ io: () => fake.socket }));

import { ConnectionPill } from './ConnectionPill';
import { __resetSocketManagerForTests, reviveSharedSocket } from '../../hooks/socket-manager';

function connect() {
  fake.socket.connected = true;
  fake.socket.active = true;
  fake.fire('connect');
}

function drop() {
  fake.socket.connected = false;
  fake.fire('disconnect', 'transport close');
}

beforeEach(() => {
  fake.handlers.clear();
  fake.socket.connected = false;
  fake.socket.active = true;
});

afterEach(() => {
  __resetSocketManagerForTests();
  vi.useRealTimers();
});

describe('ConnectionPill', () => {
  it('says live updates stopped once the server refuses the socket, and offers a reload', () => {
    render(<ConnectionPill />);
    act(() => connect());
    expect(screen.getByRole('status')).toHaveTextContent('Live');

    act(() => {
      drop();
      fake.socket.active = false;
      fake.fire('connect_error', new Error('unauthorized'));
    });

    const pill = screen.getByRole('status');
    expect(pill).toHaveTextContent('Live updates stopped');
    expect(pill.getAttribute('title')).toMatch(/Reload the page to reconnect/);
    expect(pill.getAttribute('title')).not.toMatch(/Retrying automatically/);

    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still reads reconnecting through a handshake the server could not check', () => {
    vi.useFakeTimers();
    render(<ConnectionPill />);
    act(() => connect());
    act(() => {
      drop();
      fake.socket.active = false;
      fake.fire('connect_error', new Error('unavailable'));
    });
    const pill = screen.getByRole('status');
    expect(pill).toHaveTextContent('Reconnecting…');
    expect(pill.getAttribute('title')).toMatch(/Retrying automatically/);
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
  });

  it('goes back to reconnecting when revived, and to live once connected', () => {
    render(<ConnectionPill />);
    act(() => connect());
    act(() => {
      drop();
      fake.socket.active = false;
      fake.fire('connect_error', new Error('unauthorized'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Live updates stopped');

    act(() => reviveSharedSocket());
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();

    act(() => connect());
    expect(screen.getByRole('status')).toHaveTextContent('Live');
    expect(screen.getByRole('status')).not.toHaveTextContent('stopped');
  });
});
