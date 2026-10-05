import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../ui/toast';
import type { ISession } from '../../interfaces/ISession';
import { FailureSummary } from '../session-detail/failure-summary';
import { LogViewer } from '../session-detail/log-viewer';
import { RecordingCard } from '../session-detail/recording-card';
import { DetailsCard } from '../session-detail/details-card';
import { PerformancePanel } from '../session-detail/performance-panel';
import XenonApiService from '../../api-service';
import { titleForPath } from '../../lib/document-title';
import { RUNBOOKS, lookupRunbook } from './runbook-content';
import { RunbookPage } from './runbook-page';

const failedSession = {
  id: '088cce7e-aaaa-bbbb-cccc-000000000001',
  status: 'failed',
  desired_capabilities: '{}',
  session_capabilities: '{}',
  node_id: 'n-1',
  has_live_video: false,
  startTime: '2026-09-30T20:41:00.000Z',
  failure_reason: 'NoSuchElement: id=checkout_confirm',
  failure_category: 'ELEMENT_NOT_FOUND',
  ai_analysis: 'The Confirm button moved.',
  device_udid: 'R58M1234',
  device_platform: 'android',
  device_version: '10',
  createdAt: '2026-09-30T20:41:00.000Z',
  updatedAt: '2026-09-30T20:41:00.000Z',
} as ISession;

/**
 * Every piece of text the runbooks may point at: the session page's "Why it
 * failed" card, log tabs, Recording card, Performance panel and details, and the
 * titles of the pages they send testers to.
 */
async function dashboardNames(): Promise<Set<string>> {
  vi.spyOn(XenonApiService, 'getSessionMetrics').mockResolvedValue({
    platform: 'android',
    intervalMs: 2000,
    appId: null,
    series: { deviceCpu: true, deviceMem: true, appCpu: false, appMem: false },
    samples: [],
  } as any);
  const { container } = render(
    <ToastProvider>
      <FailureSummary
        session={failedSession}
        buildName="Nightly"
        buildId="b-1"
        commands={[]}
        durationText="1m 10s"
      />
      <PerformancePanel sessionId={failedSession.id} running={false} hasTrace={false} />
      <LogViewer sessionLogs={[]} deviceLogs={[]} debugLogs={[]} profiling={[]} />
      <RecordingCard session={failedSession} />
      <DetailsCard session={failedSession} buildName="Nightly" />
    </ToastProvider>,
  );
  await screen.findByText('Performance');
  const names = new Set<string>();
  container.querySelectorAll('*').forEach((el) => {
    const text = el.textContent?.replace(/\s+/g, ' ').trim();
    if (text) names.add(text);
  });
  for (const page of ['/devices', '/selector-health']) {
    names.add(titleForPath(page).split(' · ')[0]);
  }
  return names;
}

/** What a runbook puts in bold: the names of things on screen. */
function boldNames(markdown: string): string[] {
  return Array.from(markdown.matchAll(/\*\*([^*]+)\*\*/g), (m) => m[1].replace(/\s+/g, ' '));
}

describe('runbooks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('name only what the dashboard shows', async () => {
    const names = await dashboardNames();
    for (const [key, rb] of Object.entries(RUNBOOKS)) {
      const bold = boldNames(rb.markdown);
      for (const name of bold) {
        expect(names.has(name), `${key} names "${name}", which the dashboard doesn't show`).toBe(
          true,
        );
      }
    }
    // Not vacuous: the names the runbooks use really are in there.
    for (const name of [
      'Why it failed',
      'Commands',
      'Recording',
      'Performance',
      'Devices',
      'Ended',
    ]) {
      expect(names.has(name), name).toBe(true);
    }
    expect(names.has('Selector health')).toBe(true);
    expect(boldNames(RUNBOOKS.unknown.markdown)).toContain('Why it failed');
    expect(boldNames(RUNBOOKS.app_crash.markdown)).toContain('Performance');
  });

  it("don't name screens that are gone", () => {
    for (const rb of Object.values(RUNBOOKS)) {
      expect(rb.markdown).not.toMatch(/Text Logs|Failure summary|Device health/i);
    }
  });

  it('are in plain words, for testers', () => {
    for (const [key, rb] of Object.entries(RUNBOOKS)) {
      // After the title, and without quoted text: quoting what the screen
      // shows ("Hub shutdown") is how a runbook says what lands there.
      const body = rb.markdown
        .split('\n')
        .slice(1)
        .join(' ')
        .replace(/"[^"]*"/g, '""');
      for (const term of [
        /\.ts\b/,
        /prisma/i,
        /failure_category/,
        /SessionLifecycleService|OrphanSweeper|heartbeat|watchdog/i,
        /\/var\/log/,
        /\bADB\b|\bWDA\b|go-ios|daemon/i,
        /\bhub\b|\bnode\b/i,
      ]) {
        expect(body, `${key}: ${term}`).not.toMatch(term);
      }
    }
  });

  it('have none for Infrastructure, which no failure is ever filed under', () => {
    expect(lookupRunbook('infrastructure')).toBe(RUNBOOKS.unknown);
  });

  it("are looked up by their own names only, so /runbooks/constructor isn't one", () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(lookupRunbook(name)).toBe(RUNBOOKS.unknown);
    }
  });
});

describe('RunbookPage', () => {
  const open = (category: string) =>
    render(
      <MemoryRouter initialEntries={[`/runbooks/${category}`]}>
        <Routes>
          <Route path="/runbooks/:category" element={<RunbookPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it("says, in the card's words, when a kind of failure has no runbook of its own", () => {
    open('infrastructure');
    expect(
      screen.getByText(/There's no runbook for “Infrastructure” failures yet/),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Finding out why it failed',
    );
  });

  it.each(['timeout', 'HUB_RESTART', 'element_not_found', 'wda-failure', 'unknown', 'UNKNOWN'])(
    'shows %s without that note',
    (category) => {
      open(category);
      expect(screen.queryByText(/There's no runbook for/)).toBeNull();
    },
  );
});
