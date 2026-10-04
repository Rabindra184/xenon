import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../ui/toast';
import type { ISession } from '../../interfaces/ISession';
import { FailureSummary } from '../session-detail/failure-summary';
import { LogViewer } from '../session-detail/log-viewer';
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

/** Every piece of text the session page's "Why it failed" card and log tabs show. */
function sessionPageNames(): Set<string> {
  const { container } = render(
    <ToastProvider>
      <FailureSummary
        session={failedSession}
        buildName="Nightly"
        buildId="b-1"
        commands={[]}
        durationText="1m 10s"
      />
      <LogViewer sessionLogs={[]} deviceLogs={[]} debugLogs={[]} profiling={[]} />
    </ToastProvider>,
  );
  const names = new Set<string>();
  container.querySelectorAll('*').forEach((el) => {
    const text = el.textContent?.replace(/\s+/g, ' ').trim();
    if (text) names.add(text);
  });
  return names;
}

/** What a runbook puts in bold: the names of things on screen. */
function boldNames(markdown: string): string[] {
  return Array.from(markdown.matchAll(/\*\*([^*]+)\*\*/g), (m) => m[1].replace(/\s+/g, ' '));
}

describe('runbooks', () => {
  it('name only what the dashboard shows', () => {
    const names = sessionPageNames();
    names.add(titleForPath('/devices').split(' · ')[0]);
    for (const [key, rb] of Object.entries(RUNBOOKS)) {
      const bold = boldNames(rb.markdown);
      for (const name of bold) {
        expect(names.has(name), `${key} names "${name}", which the dashboard doesn't show`).toBe(
          true,
        );
      }
    }
    // Not vacuous: the session page's names really are in there.
    expect(names.has('Why it failed')).toBe(true);
    expect(names.has('Commands')).toBe(true);
    expect(boldNames(RUNBOOKS.unknown.markdown)).toContain('Why it failed');
  });

  it("don't name screens that are gone", () => {
    for (const rb of Object.values(RUNBOOKS)) {
      expect(rb.markdown).not.toMatch(/Text Logs|Failure summary|Device health/i);
    }
  });

  it('are in plain words, for testers', () => {
    for (const [key, rb] of Object.entries(RUNBOOKS)) {
      const body = rb.markdown.split('\n').slice(1).join('\n'); // after the title
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
    open('element_not_found');
    expect(
      screen.getByText(/There's no runbook for “Element Not Found” failures yet/),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Finding out why it failed',
    );
  });

  it.each(['timeout', 'HUB_RESTART', 'unknown', 'UNKNOWN'])(
    'shows %s without that note',
    (category) => {
      open(category);
      expect(screen.queryByText(/There's no runbook for/)).toBeNull();
    },
  );
});
