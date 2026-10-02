import { describe, it, expect } from 'vitest';
import { asSessionMetrics, formatElapsed, formatMb, formatPct, stats } from './performance';

describe('performance helpers', () => {
  it('accepts only the metrics answer', () => {
    expect(asSessionMetrics([])).toBeNull();
    expect(asSessionMetrics({ error: true, message: 'Session not found' })).toBeNull();
    expect(asSessionMetrics(null)).toBeNull();
    const ok = asSessionMetrics({
      platform: 'android',
      intervalMs: 2000,
      appId: 'com.acme.shop',
      series: { deviceCpu: true, deviceMem: true, appCpu: true, appMem: true },
      samples: [
        { t: 1, deviceCpu: null, deviceMemMb: 1, deviceMemTotalMb: 2, appCpu: null, appMemMb: 3 },
      ],
    });
    expect(ok?.samples).toHaveLength(1);
    expect(ok?.appId).toBe('com.acme.shop');
  });

  it('gives peak and average over recorded values only', () => {
    expect(stats([null, null])).toBeNull();
    expect(stats([1, null, 3])).toEqual({ peak: 3, average: 2 });
  });

  it('formats elapsed time, percentages and memory', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
    expect(formatPct(0)).toBe('0%');
    expect(formatPct(5.12)).toBe('5.1%');
    expect(formatPct(20)).toBe('20%');
    expect(formatMb(326.6)).toBe('327 MB');
    expect(formatMb(2848.2)).toBe('2.8 GB');
  });
});
