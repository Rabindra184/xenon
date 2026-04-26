import { expect } from 'chai';
import { resolveWindow } from '../../../src/services/bug-report/window';

const FIXED_NOW = new Date('2026-04-26T10:00:00.000Z').getTime();

function session(overrides: Partial<{ startTime: string; endTime: string | null }>) {
  return {
    startTime: '2026-04-26T09:50:00.000Z',
    endTime: '2026-04-26T09:55:00.000Z',
    ...overrides,
  } as any;
}

describe('resolveWindow', () => {
  it('mode=full returns the entire session', () => {
    const w = resolveWindow(session({}), 'full', undefined, FIXED_NOW);
    expect(w.startedAt).to.equal('2026-04-26T09:50:00.000Z');
    expect(w.endedAt).to.equal('2026-04-26T09:55:00.000Z');
    expect(w.durationMs).to.equal(5 * 60 * 1000);
    expect(w.requestedDurationMs).to.equal(5 * 60 * 1000);
  });

  it('mode=full uses now() if endTime is null', () => {
    const w = resolveWindow(session({ endTime: null }), 'full', undefined, FIXED_NOW);
    expect(w.endedAt).to.equal('2026-04-26T10:00:00.000Z');
    expect(w.durationMs).to.equal(10 * 60 * 1000);
  });

  it('mode=slice anchors to endTime, default 60s', () => {
    const w = resolveWindow(session({}), 'slice', undefined, FIXED_NOW);
    expect(w.endedAt).to.equal('2026-04-26T09:55:00.000Z');
    expect(w.startedAt).to.equal('2026-04-26T09:54:00.000Z');
    expect(w.durationMs).to.equal(60 * 1000);
    expect(w.requestedDurationMs).to.equal(60 * 1000);
  });

  it('mode=slice uses now() if endTime is null (live session)', () => {
    const w = resolveWindow(session({ endTime: null }), 'slice', 30, FIXED_NOW);
    expect(w.endedAt).to.equal('2026-04-26T10:00:00.000Z');
    expect(w.startedAt).to.equal('2026-04-26T09:59:30.000Z');
    expect(w.durationMs).to.equal(30 * 1000);
  });

  it('mode=slice clamps to session.startTime when window is larger than session', () => {
    const w = resolveWindow(
      session({ startTime: '2026-04-26T09:54:30.000Z', endTime: '2026-04-26T09:55:00.000Z' }),
      'slice',
      60,
      FIXED_NOW,
    );
    expect(w.startedAt).to.equal('2026-04-26T09:54:30.000Z');
    expect(w.endedAt).to.equal('2026-04-26T09:55:00.000Z');
    expect(w.durationMs).to.equal(30 * 1000);
    expect(w.requestedDurationMs).to.equal(60 * 1000);
  });

  it('throws on invalid windowSec', () => {
    expect(() => resolveWindow(session({}), 'slice', 0, FIXED_NOW)).to.throw(/windowSec/);
    expect(() => resolveWindow(session({}), 'slice', 1000, FIXED_NOW)).to.throw(/windowSec/);
  });
});
