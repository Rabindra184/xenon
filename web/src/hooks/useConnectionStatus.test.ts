import { describe, it, expect } from 'vitest';
import { describeConnection, RECONNECT_GRACE_MS } from './useConnectionStatus';

const T = new Date('2026-09-24T14:32:00').getTime();

describe('describeConnection', () => {
  it('is Live while connected, with no timer, however long nothing has happened', () => {
    expect(describeConnection(true, null, T + 3 * 60 * 60 * 1000)).toMatchObject({
      tone: 'live',
      label: 'Live',
    });
  });

  it('says Connecting… before the first connection, not Reconnecting…', () => {
    expect(describeConnection(false, T, T + 1000, false)).toMatchObject({
      tone: 'reconnecting',
      label: 'Connecting…',
    });
  });

  it('says Reconnecting… during the grace period after a drop', () => {
    expect(describeConnection(false, T, T + RECONNECT_GRACE_MS - 1)).toMatchObject({
      tone: 'reconnecting',
      label: 'Reconnecting…',
    });
  });

  it('says Disconnected, with when, once the grace period has passed', () => {
    const s = describeConnection(false, T, T + RECONNECT_GRACE_MS);
    expect(s.tone).toBe('down');
    expect(s.label).toMatch(/^Disconnected · since /);
    expect(s.title).toMatch(/may be out of date/);
  });

  it('says live updates stopped for a refused socket, and offers a reload, not a retry', () => {
    // Refused: neither socket.io nor Xenon tries again, however long it has been.
    for (const now of [T + 1000, T + RECONNECT_GRACE_MS * 10]) {
      const s = describeConnection(false, T, now, true, true);
      expect(s).toMatchObject({ tone: 'down', label: 'Live updates stopped', action: 'reload' });
      expect(s.title).toMatch(/Reload the page to reconnect/);
      expect(s.title).not.toMatch(/Retrying automatically/);
    }
  });

  it('offers no reload while reconnecting', () => {
    expect(describeConnection(false, T, T + 1000).action).toBeUndefined();
  });
});
