import { describe, it, expect } from 'vitest';
import { isReportableProcessDeath } from '../src/main/processDeath';

describe('isReportableProcessDeath', () => {
  it('suppresses every death while the app is quitting (teardown SIGTERMs the whole tree)', () => {
    for (const reason of ['killed', 'crashed', 'clean-exit', 'oom', 'abnormal-exit']) {
      expect(isReportableProcessDeath(reason, true)).toBe(false);
    }
  });

  it('suppresses a clean exit even while running', () => {
    expect(isReportableProcessDeath('clean-exit', false)).toBe(false);
  });

  it('reports a genuine crash while the app is running', () => {
    expect(isReportableProcessDeath('crashed', false)).toBe(true);
    expect(isReportableProcessDeath('oom', false)).toBe(true);
    expect(isReportableProcessDeath('launch-failed', false)).toBe(true);
    expect(isReportableProcessDeath('integrity-failure', false)).toBe(true);
    expect(isReportableProcessDeath('abnormal-exit', false)).toBe(true);
  });

  it("reports a 'killed' death while running — an OS watchdog killing a hung GPU is the signal we want", () => {
    expect(isReportableProcessDeath('killed', false)).toBe(true);
  });

  // The actual false positive that nearly triggered a merge: the shutdown trio,
  // all reason='killed' during teardown, must all be suppressed.
  it('suppresses the real-world shutdown trio (renderer + utility + GPU, killed, isQuitting)', () => {
    expect(isReportableProcessDeath('killed', true)).toBe(false);
  });
});
