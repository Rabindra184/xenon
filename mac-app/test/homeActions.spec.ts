import { describe, expect, it, vi } from 'vitest';
import { runHomeAction, type HomeActionsInput } from '../src/renderer/src/hooks/useHomeActions';
import type { ServerState } from '../src/shared/types';

// What Home's buttons ask for. R83: Try again is a look the person asked for, so it reads the login
// shell again (R80, R82); Start's own check is not, and reuses a good read.
function input(server: Partial<ServerState> = {}): HomeActionsInput {
  return {
    server: { status: 'stopped', dashboardUrl: null, profileId: null, ...server } as ServerState,
    draft: null,
    profiles: [],
    requestStart: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    refreshNow: vi.fn(async () => null),
    runSetup: vi.fn(async () => {}),
    setPort: vi.fn(),
    flush: vi.fn(),
    select: vi.fn(),
    go: vi.fn(),
    seeWhatHappened: vi.fn(),
    focus: vi.fn()
  } as unknown as HomeActionsInput;
}

describe('runHomeAction', () => {
  it('Try again asks for a fresh look, which reads the login shell again (R83)', () => {
    const i = input();
    runHomeAction('try-again', i);
    expect(i.refreshNow).toHaveBeenCalledTimes(1);
    expect(i.refreshNow).toHaveBeenCalledWith({ fresh: true });
  });

  it('Start asks for the start, whose own check reuses a good read: no fresh look here (R82)', () => {
    const i = input();
    runHomeAction('start', i);
    expect(i.requestStart).toHaveBeenCalledTimes(1);
    expect(i.refreshNow).not.toHaveBeenCalled();
  });

  it('Open dashboard sends no address: main opens its own (M8)', () => {
    const openDashboard = vi.fn(async () => true);
    vi.stubGlobal('window', { xenon: { server: { openDashboard } } });
    try {
      runHomeAction('open-dashboard', input({ status: 'running', dashboardUrl: 'http://127.0.0.1:4797/xenon/' }));
      expect(openDashboard).toHaveBeenCalledWith();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
