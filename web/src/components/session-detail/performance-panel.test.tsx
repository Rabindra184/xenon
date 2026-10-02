import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import XenonApiService from '../../api-service';
import { METRICS_REFRESH_MS, PerformancePanel } from './performance-panel';

const android = (n: number) => ({
  platform: 'android',
  intervalMs: 2000,
  appId: 'com.acme.shop',
  series: { deviceCpu: true, deviceMem: true, appCpu: true, appMem: true },
  samples: Array.from({ length: n }, (_, i) => ({
    t: 1_000_000 + i * 2000,
    deviceCpu: i === 0 ? null : 20 + i,
    deviceMemMb: 2800 + i,
    deviceMemTotalMb: 5620.8,
    appCpu: i === 0 ? null : 5,
    appMemMb: 300 + i,
  })),
});
const ios = (n: number) => ({
  ...android(n),
  platform: 'ios',
  appId: null,
  series: { deviceCpu: true, deviceMem: false, appCpu: false, appMem: false },
});

const answer = (body: unknown) =>
  vi.spyOn(XenonApiService, 'getSessionMetrics').mockResolvedValue(body as any);

describe('PerformancePanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("charts an Android session's CPU and memory, with the app named", async () => {
    answer(android(5));
    render(<PerformancePanel sessionId="s1" running={false} hasTrace={false} />);

    expect(await screen.findByRole('img', { name: 'CPU over the session' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Memory over the session' })).toBeTruthy();
    expect(screen.getAllByText('com.acme.shop').length).toBeGreaterThan(0);
    expect(screen.getByText(/peak 304 MB/)).toBeTruthy();
  });

  it("charts only an iPhone's device CPU, and says why", async () => {
    answer(ios(5));
    render(<PerformancePanel sessionId="s1" running={false} hasTrace />);

    expect(await screen.findByRole('img', { name: 'CPU over the session' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Memory over the session' })).toBeNull();
    expect(screen.getByText(/iPhone: device CPU only/)).toBeTruthy();
    expect(screen.getByText(/Instruments trace is under Details/)).toBeTruthy();
  });

  it('says why an ended session has no figures', async () => {
    answer({ ...android(0) });
    render(<PerformancePanel sessionId="s1" running={false} hasTrace={false} />);

    expect(await screen.findByText('No performance figures for this session')).toBeTruthy();
  });

  it('treats an answer that is not the metrics shape as no figures', async () => {
    answer([]);
    render(<PerformancePanel sessionId="s1" running={false} hasTrace={false} />);

    expect(await screen.findByText('No performance figures for this session')).toBeTruthy();
  });

  it('says it is collecting while a running session has under two samples', async () => {
    answer(android(1));
    render(<PerformancePanel sessionId="s1" running hasTrace={false} />);

    expect(await screen.findByText(/Collecting/)).toBeTruthy();
  });

  it('asks again every 10 s while the session runs', async () => {
    vi.useFakeTimers();
    const spy = answer(android(3));
    render(<PerformancePanel sessionId="s1" running hasTrace={false} />);
    expect(spy).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(METRICS_REFRESH_MS);
    });

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
