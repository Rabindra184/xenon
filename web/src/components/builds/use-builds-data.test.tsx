import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const api = vi.hoisted(() => ({ getBuilds: vi.fn(), getSessions: vi.fn() }));
vi.mock('../../api-service', () => ({ default: api }));
vi.mock('../../hooks/useSocket', () => ({ useSocket: () => ({ on: () => () => undefined }) }));

import { useBuildsData, SESSION_PAGE_SIZE, SESSION_POLL_MAX } from './use-builds-data';

const row = (n: number) => ({
  id: `s-${String(n).padStart(4, '0')}`,
  status: 'success',
  createdAt: new Date(Date.UTC(2026, 9, 1, 12, 0, 0) - n * 60_000).toISOString(),
});

let more: () => Promise<void> = async () => undefined;
const Probe: React.FC = () => {
  const d = useBuildsData({ withSessions: true, timeFilter: 'all' });
  more = d.showMore;
  return (
    <div data-testid="probe">
      {d.sessions.length} {d.hasMore ? 'more' : 'all'} {d.sessions[d.sessions.length - 1]?.id}
    </div>
  );
};

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
};

describe('useBuildsData paging', () => {
  // 450 sessions, newest first, a minute apart.
  let all: ReturnType<typeof row>[];

  beforeEach(() => {
    vi.useFakeTimers();
    all = Array.from({ length: 450 }, (_, i) => row(i));
    api.getBuilds.mockResolvedValue([]);
    api.getSessions.mockImplementation(async (o: any) => {
      let out = all;
      if (o.since) out = out.filter((r) => r.createdAt >= o.since);
      if (o.before) {
        out = out.filter(
          (r) => r.createdAt < o.before || (r.createdAt === o.before && r.id < o.beforeId),
        );
      }
      return out.slice(0, o.limit);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('loads the newest page, and says there is more', async () => {
    render(<Probe />);
    await flush();
    expect(api.getSessions.mock.calls[0][0]).toMatchObject({ limit: SESSION_PAGE_SIZE });
    expect(screen.getByTestId('probe')).toHaveTextContent(`${SESSION_PAGE_SIZE} more s-0199`);
  });

  it('loads the next page after the last row, until there is no more', async () => {
    render(<Probe />);
    await flush();
    await act(() => more());
    const call = api.getSessions.mock.calls.at(-1)[0];
    expect(call).toMatchObject({
      before: row(199).createdAt,
      beforeId: 's-0199',
      limit: SESSION_PAGE_SIZE,
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('400 more s-0399');

    await act(() => more());
    expect(screen.getByTestId('probe')).toHaveTextContent('450 all s-0449');
  });

  it('keeps every loaded row as new sessions arrive, with no gap and no repeat', async () => {
    render(<Probe />);
    await flush();
    await act(() => more());

    // Five new sessions push the newest page down by five rows.
    all = [...Array.from({ length: 5 }, (_, i) => row(-1 - i)).reverse(), ...all];
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await flush();

    // The poll covers everything from the older pages' newest row up.
    const poll = api.getSessions.mock.calls.at(-1)[0];
    expect(poll).toMatchObject({ since: row(200).createdAt, limit: SESSION_POLL_MAX });
    expect(screen.getByTestId('probe')).toHaveTextContent('405 more s-0399');
  });
});
