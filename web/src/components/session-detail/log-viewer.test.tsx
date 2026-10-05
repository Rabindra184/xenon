import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider } from '../ui/toast';
import { LogViewer, VIRTUAL_FROM } from './log-viewer';
import {
  installFakeLayout,
  settle,
  userScroll,
  type FakeLayout,
} from '../device-control/logcat/testing/fakeLayout';

const pad = (n: number) => String(n).padStart(2, '0');

/** An Android session's Device logs as the server saves them: logcat lines. */
const deviceLines = (n: number, errorEvery = 0) =>
  Array.from({ length: n }, (_, i) => {
    const level = errorEvery && i % errorEvery === 0 ? 'E' : 'D';
    return {
      id: `d${i}`,
      session_id: 's1',
      log_type: 'DEVICE',
      message: `10-05 09:${pad(Math.floor(i / 600) % 60)}:${pad(Math.floor(i / 10) % 60)}.${String(i % 1000).padStart(3, '0')}  4127  4127 ${level} Tag     : line ${i}`,
      timestamp: new Date(Date.UTC(2026, 9, 5, 3, 30) + i * 100).toISOString(),
    };
  });

const scroller = () => document.querySelector('[data-log-scroller]') as HTMLElement;
const drawn = () => Array.from(scroller().querySelectorAll('[data-index]')) as HTMLElement[];

function viewer(deviceLogs: ReturnType<typeof deviceLines>) {
  render(
    <ToastProvider>
      <LogViewer sessionLogs={[]} deviceLogs={deviceLogs} debugLogs={[]} profiling={[]} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Device logs/ }));
}

/**
 * An Android session's Device logs hold up to 12,000 lines. Drawn whole, the
 * tab froze the page for seconds; a long list draws only what is on screen.
 */
describe('LogViewer: a long Device logs tab', () => {
  let layout: FakeLayout;
  beforeEach(() => {
    layout = installFakeLayout({
      isList: (el) => el.hasAttribute('data-log-scroller'),
      viewportHeight: 400,
      rowHeight: () => 33,
    });
  });
  afterEach(() => layout.restore());

  it('draws the rows on screen, not all 12,002', async () => {
    viewer(deviceLines(12_002));
    await settle();

    const rows = drawn();
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(100);
    expect(rows[0]).toHaveTextContent('line 0');
    expect(screen.getByRole('button', { name: /Device logs/ })).toHaveTextContent('12k');
  });

  it('reaches the last line when scrolled to the end', async () => {
    viewer(deviceLines(12_002));
    await settle();

    userScroll(scroller(), 12_002 * 33);
    await settle();

    expect(drawn().some((r) => r.textContent?.includes('line 12001'))).toBe(true);
    expect(drawn().some((r) => r.textContent?.includes('line 0 '))).toBe(false);
  });

  it('shows only the errors when Errors only is ticked', async () => {
    viewer(deviceLines(12_002, 6));
    await settle();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Show only error rows' }));
    await settle();

    const rows = drawn();
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((r) => /\bE Tag/.test(r.textContent ?? ''))).toBe(true);
    expect(rows[1]).toHaveTextContent('line 6');
  });

  it('opens a row to show all of it', async () => {
    viewer(deviceLines(VIRTUAL_FROM + 1));
    await settle();

    const row = screen.getByText(/: line 2$/).closest('button') as HTMLElement;
    fireEvent.click(row);

    expect(row).toHaveAttribute('aria-expanded', 'true');
  });

  it('draws a short list whole, as before', async () => {
    viewer(deviceLines(VIRTUAL_FROM - 1));
    await settle();

    expect(drawn()).toHaveLength(0);
    expect(screen.getByText(/line 498$/)).toBeInTheDocument();
  });
});
