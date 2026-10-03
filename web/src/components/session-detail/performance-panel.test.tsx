import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import XenonApiService from '../../api-service';
import { METRICS_REFRESH_MS, PerformancePanel, memoryAxisMax } from './performance-panel';

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

describe('memoryAxisMax', () => {
  it('rounds to MB below a gigabyte and to whole GB above', () => {
    expect(memoryAxisMax(0)).toBe(1);
    expect(memoryAxisMax(232)).toBe(250);
    expect(memoryAxisMax(5620.8)).toBe(6144);
  });
});

describe('PerformancePanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("charts an Android session's CPU and memory, with the app named", async () => {
    answer(android(5));
    render(<PerformancePanel sessionId="s1" running={false} hasTrace={false} />);

    expect(await screen.findByRole('img', { name: 'CPU over the session' })).toBeTruthy();
    // The app's memory gets its own chart: beside the device's gigabytes its
    // line would lie flat along the bottom.
    expect(screen.getByRole('img', { name: 'App memory over the session' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Device memory over the session' })).toBeTruthy();
    expect(screen.getAllByText('com.acme.shop').length).toBeGreaterThan(0);
    expect(screen.getByText(/peak 304 MB/)).toBeTruthy();
  });

  it("charts only an iPhone's device CPU, and says why", async () => {
    answer(ios(5));
    render(<PerformancePanel sessionId="s1" running={false} hasTrace />);

    expect(await screen.findByRole('img', { name: 'CPU over the session' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /memory over the session/ })).toBeNull();
    expect(screen.getByText(/On iPhones, only the device's overall CPU is recorded/)).toBeTruthy();
    expect(screen.getByText(/download the Performance trace under Details/)).toBeTruthy();
  });

  it('says why an ended session has no figures', async () => {
    answer({ ...android(0) });
    render(<PerformancePanel sessionId="s1" running={false} hasTrace={false} />);

    expect(await screen.findByText('No performance data for this session')).toBeTruthy();
  });

  it('treats an answer that is not the metrics shape as no figures', async () => {
    answer([]);
    render(<PerformancePanel sessionId="s1" running={false} hasTrace={false} />);

    expect(await screen.findByText('No performance data for this session')).toBeTruthy();
  });

  it('says a running session nothing samples is not recorded, instead of collecting', async () => {
    answer({ ...android(0), recording: 'off' });
    render(<PerformancePanel sessionId="s1" running hasTrace={false} />);

    expect(await screen.findByText("Performance isn't recorded for this session")).toBeTruthy();
    expect(screen.queryByText(/Collecting/)).toBeNull();
    // A device on another machine is recorded now, unless that machine is older.
    expect(screen.getByText(/on a machine that needs updating/)).toBeTruthy();
    expect(screen.queryByText(/connected to this server|another machine/)).toBeNull();
  });

  it('says why an ended session has no figures, the same way', async () => {
    answer(android(0));
    render(<PerformancePanel sessionId="s1" running={false} hasTrace={false} />);

    expect(await screen.findByText(/on a machine that needed updating/)).toBeTruthy();
    expect(screen.queryByText(/connected to this server|another machine/)).toBeNull();
  });

  it('says when sampling stopped, and keeps the figures it has', async () => {
    answer({ ...android(5), recording: 'stopped' });
    render(<PerformancePanel sessionId="s1" running hasTrace={false} />);

    expect(
      await screen.findByText(/Recording stopped: the device stopped responding/),
    ).toBeTruthy();
    expect(screen.getByRole('img', { name: 'CPU over the session' })).toBeTruthy();
  });

  it('labels a line that followed several foreground apps as such, and breaks it between them', async () => {
    const m = android(4);
    m.appId = 'com.b.two';
    m.samples = m.samples.map((s, i) => ({ ...s, app: i < 2 ? 'com.a.one' : 'com.b.two' }));
    answer(m);
    render(<PerformancePanel sessionId="s1" running={false} hasTrace={false} />);

    const memory = await screen.findByRole('img', { name: 'App memory over the session' });
    expect(screen.getAllByText('Foreground app').length).toBeGreaterThan(0);
    expect(screen.queryByText('com.b.two')).toBeNull();
    const d = memory.querySelector('path[data-series="appMem"]')?.getAttribute('d') ?? '';
    expect(d.match(/M/g)).toHaveLength(2);
  });

  it('says it is collecting while a running session has under two samples', async () => {
    answer(android(1));
    render(<PerformancePanel sessionId="s1" running hasTrace={false} />);

    expect(await screen.findByText(/Collecting/)).toBeTruthy();
  });

  // The panel is read by testers, not by whoever runs the server: no tool
  // names, setting keys or server topology in anything it says.
  it.each([
    ['an Android chart', android(5), false, true],
    ['an iPhone chart', ios(5), false, true],
    ['an ended session with nothing recorded', android(0), false, false],
    ['a running session nothing samples', { ...android(0), recording: 'off' }, true, false],
    ['a stopped recording', { ...android(5), recording: 'stopped' }, true, false],
    ['a session still collecting', android(1), true, false],
  ])('says nothing technical for %s', async (_state, body, running, hasTrace) => {
    answer(body);
    const { container } = render(
      <PerformancePanel sessionId="s1" running={running} hasTrace={hasTrace} />,
    );
    await waitFor(() => expect(screen.queryByText('Loading performance…')).toBeNull());

    expect(container.textContent).not.toMatch(
      /go-ios|sysmontap|\badb\b|Instruments|sessionMetrics|another server|Xenon records/i,
    );
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
