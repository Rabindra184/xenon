import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSessionLogs: vi.fn(),
  getDeviceLogs: vi.fn(),
  getDebugLogs: vi.fn(),
  getProfilingData: vi.fn(),
}));
vi.mock('../../api-service', () => ({ default: api }));

import { useSessionDetail, LIVE_REFRESH_MS } from './use-session-detail';

const Probe: React.FC = () => {
  const d = useSessionDetail('s-1');
  return (
    <div data-testid="probe">
      {d.loading ? 'loading' : `${d.session?.status} ${d.sessionLogs.length}`}
    </div>
  );
};

const flush = async () => {
  // Let the fetches' promises settle.
  for (let i = 0; i < 5; i++) await act(async () => undefined);
};

describe('useSessionDetail', () => {
  let status: string;
  let commands: unknown[];

  beforeEach(() => {
    vi.useFakeTimers();
    status = 'running';
    commands = [{ id: 'c1' }];
    api.getSession.mockImplementation(async () => ({ id: 's-1', status }));
    api.getSessionLogs.mockImplementation(async () => commands);
    api.getDeviceLogs.mockResolvedValue([]);
    api.getDebugLogs.mockResolvedValue([]);
    api.getProfilingData.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('follows a running session without showing the loading state again', async () => {
    render(<Probe />);
    await flush();
    expect(screen.getByTestId('probe')).toHaveTextContent('running 1');

    commands = [{ id: 'c2' }, { id: 'c1' }];
    await act(async () => {
      vi.advanceTimersByTime(LIVE_REFRESH_MS);
    });
    await flush();
    expect(screen.getByTestId('probe')).toHaveTextContent('running 2');
    // Only the session and its commands are asked for while it runs.
    expect(api.getDeviceLogs).toHaveBeenCalledTimes(1);
  });

  it('loads everything once more when the session ends, then stops asking', async () => {
    render(<Probe />);
    await flush();

    status = 'success';
    await act(async () => {
      vi.advanceTimersByTime(LIVE_REFRESH_MS);
    });
    await flush();
    expect(screen.getByTestId('probe')).toHaveTextContent('success 1');
    expect(api.getDeviceLogs).toHaveBeenCalledTimes(2);

    const calls = api.getSession.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(LIVE_REFRESH_MS * 3);
    });
    await flush();
    expect(api.getSession.mock.calls.length).toBe(calls);
  });

  it('never polls a session that has ended', async () => {
    status = 'failed';
    render(<Probe />);
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(LIVE_REFRESH_MS * 3);
    });
    await flush();
    expect(api.getSession).toHaveBeenCalledTimes(1);
  });
});
