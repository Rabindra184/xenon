import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

type Handler = (payload: any) => void;
const handlers = new Map<string, Handler>();
vi.mock('../../hooks/useSocket', () => ({
  useSocket: () => ({
    isConnected: true,
    on: (event: string, cb: Handler) => {
      handlers.set(event, cb);
      return () => handlers.delete(event);
    },
  }),
}));

import { NetworkPanel } from './network-panel';

const request = {
  id: 'r1',
  sessionId: 's1',
  ts: 1_700_000_000_000,
  method: 'GET',
  url: 'https://api.example.com/me',
  host: 'api.example.com',
  path: '/me',
  reqHeaders: {},
  resStatus: 200,
  resHeaders: {},
  durationMs: 12,
  mocked: false,
  modified: false,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

let answers: Response[];

// Words a tester shouldn't have to know: setting keys, file names, tools.
const INTERNAL = /interceptor\.enabled|plugin config|xe:|adb|proxy|404|403|admin-only route/i;

describe('NetworkPanel', () => {
  beforeEach(() => {
    handlers.clear();
    answers = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const next = answers.shift();
      if (!next) throw new Error('unexpected fetch');
      return next;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tells a member that only admins can see the requests, and offers no HAR they can't open", async () => {
    answers.push(json(403, { error: 'requires role >= ADMIN' }));
    const { container } = render(<NetworkPanel sessionId="s1" sessionEnded />);

    expect(await screen.findByText('Only admins can see network requests')).toBeTruthy();
    expect(screen.queryByText('No network capture')).toBeNull();
    expect(screen.queryByText('HAR')).toBeNull();
    expect(container.textContent ?? '').not.toMatch(INTERNAL);
  });

  it('says the same on a running session', async () => {
    answers.push(json(403, { error: 'requires role >= ADMIN' }));
    render(<NetworkPanel sessionId="s1" sessionEnded={false} />);

    expect(await screen.findByText('Only admins can see network requests')).toBeTruthy();
    expect(screen.queryByText(/interception disabled/i)).toBeNull();
  });

  it('says how to turn capture on, in plain words, for a running session without it', async () => {
    answers.push(json(404, { error: 'interceptor inactive', sessionId: 's1' }));
    const { container } = render(<NetworkPanel sessionId="s1" sessionEnded={false} />);

    expect(await screen.findByText('Network capture is off')).toBeTruthy();
    expect(container.textContent ?? '').not.toMatch(INTERNAL);
  });

  it('says a finished session captured nothing, in plain words', async () => {
    answers.push(json(404, { error: 'interceptor inactive', sessionId: 's1' }));
    const { container } = render(<NetworkPanel sessionId="s1" sessionEnded />);

    expect(await screen.findByText('No network capture')).toBeTruthy();
    expect(container.textContent ?? '').not.toMatch(INTERNAL);
  });

  it('keeps showing the requests, from the saved capture, when the session ends', async () => {
    answers.push(json(200, { requests: [request] }));
    render(<NetworkPanel sessionId="s1" sessionEnded={false} />);
    expect(await screen.findByText('api.example.com')).toBeTruthy();

    answers.push(json(200, { requests: [request] }));
    await act(async () => {
      handlers.get('interceptor_session_stopped')?.({ sessionId: 's1' });
    });

    expect(await screen.findByText('api.example.com')).toBeTruthy();
    expect(screen.getByText('HAR')).toBeTruthy();
    expect(screen.queryByText('No network capture')).toBeNull();
    expect(screen.queryByText('Network capture is off')).toBeNull();
  });
});
