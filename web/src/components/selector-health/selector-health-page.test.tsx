import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import XenonApiService from '../../api-service';
import {
  IHealingSummaryResponse,
  ISelectorDetailResponse,
  ISelectorListItem,
  ISelectorListResponse,
} from '../../interfaces/IHealingEvent';

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  me: { role: 'MEMBER', userId: 'u-1' } as Record<string, unknown>,
  listeners: new Map<string, Set<(data: unknown) => void>>(),
}));
vi.mock('../ui/toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('../../hooks/useSocket', () => ({
  useSocket: () => ({
    on: (event: string, fn: (data: unknown) => void) => {
      const set = h.listeners.get(event) ?? new Set();
      set.add(fn);
      h.listeners.set(event, set);
      return () => set.delete(fn);
    },
  }),
}));
const emit = (event: string, data: unknown) =>
  act(() => h.listeners.get(event)?.forEach((fn) => fn(data)));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ me: h.me }) }));

import SelectorHealthPage from './selector-health-page';
import { SelectorDetailRedirect } from './selector-detail-redirect';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 8, 30);
const A = '//android.widget.Button[@text="Confirm"]';
const B = 'com.acme:id/cart_total';
const JARGON = /tuple|etalon|go-ios|\badb\b|estCost|Brittle|Avg conf|sessionMetrics|\$\d/i;

const SUMMARY: IHealingSummaryResponse = {
  windowDays: 30,
  current: {
    totalHeals: 265,
    distinctSelectors: 7,
    sessionsTouched: 61,
    byTier: {},
    timeSpentMs: 840_000,
  },
  prior: {
    totalHeals: 190,
    distinctSelectors: 9,
    sessionsTouched: 50,
    byTier: {},
    timeSpentMs: 660_000,
  },
  trend: [
    { t: t0, heals: 3, aiHeals: 1 },
    { t: t0 + DAY, heals: 5, aiHeals: 0 },
  ],
};

const item = (selector: string, heals: number): ISelectorListItem => ({
  strategy: 'xpath',
  selector,
  heals,
  sessions: 2,
  lastHealedAt: new Date().toISOString(),
  timeSpentMs: 9000,
  topMethod: 'Fuzzy XML',
  suggestion: { selector: `${selector}-fixed`, strategy: 'xpath', share: 0.5 },
  state: null,
});

const LIST: ISelectorListResponse = {
  tab: 'fix',
  days: 30,
  page: 1,
  pageSize: 50,
  total: 2,
  counts: { fix: 2, verifying: 0, fixed: 0, muted: 0 },
  canAct: true,
  items: [item(A, 4), item(B, 2)],
};

const detailFor = (selector: string): ISelectorDetailResponse => ({
  strategy: 'xpath',
  selector,
  days: 30,
  heals: 2,
  sessions: 1,
  timeSpentMs: 2000,
  firstHealedAt: null,
  lastHealedAt: null,
  daily: [],
  suggestions: [],
  platforms: [],
  builds: [],
  devices: [],
  recent: [],
  state: null,
  activity: [],
  canAct: true,
});

const Where = () => {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
};

function renderPage(path = '/selector-health') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/selector-health"
          element={
            <>
              <SelectorHealthPage />
              <Where />
            </>
          }
        />
        <Route path="/selector-health/detail" element={<SelectorDetailRedirect />} />
      </Routes>
    </MemoryRouter>,
  );
}

type Api = typeof XenonApiService;
let listSpy: MockInstance<
  Parameters<Api['getHealingSelectors']>,
  ReturnType<Api['getHealingSelectors']>
>;
let panelSpy: MockInstance<
  Parameters<Api['getSelectorPanel']>,
  ReturnType<Api['getSelectorPanel']>
>;
let summarySpy: MockInstance<
  Parameters<Api['getHealingSummary']>,
  ReturnType<Api['getHealingSummary']>
>;

describe('SelectorHealthPage', () => {
  beforeEach(() => {
    summarySpy = vi.spyOn(XenonApiService, 'getHealingSummary').mockResolvedValue(SUMMARY);
    listSpy = vi.spyOn(XenonApiService, 'getHealingSelectors').mockResolvedValue(LIST);
    panelSpy = vi
      .spyOn(XenonApiService, 'getSelectorPanel')
      .mockImplementation(async (_s: string, selector: string) => ({
        status: 200,
        body: detailFor(selector),
      }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    h.me = { role: 'MEMBER', userId: 'u-1' };
  });

  it('shows the summary, the trend and what to fix', async () => {
    renderPage();
    expect(await screen.findByText(A)).toBeTruthy();
    expect(screen.getByText('Selectors that needed healing')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Heals per day' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send digest/ })).toBeNull();
  });

  it('offers the digest to admins', async () => {
    h.me = { role: 'ADMIN', userId: 'u-1' };
    renderPage();
    expect(await screen.findByRole('button', { name: /Send digest/ })).toBeTruthy();
  });

  it('opens a selector beside the list, narrowing it, and keeps it in the address', async () => {
    renderPage();
    fireEvent.click(await screen.findByText(A));
    expect(await screen.findByRole('complementary', { name: 'Selector details' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Suggested fix' })).toBeNull();
    expect(screen.getByTestId('where').textContent).toContain(`selector=${encodeURIComponent(A)}`);
  });

  it('moves to the next selector with the down arrow, and closes with Escape', async () => {
    renderPage(`/selector-health?strategy=xpath&selector=${encodeURIComponent(A)}`);
    await screen.findByRole('complementary', { name: 'Selector details' });
    await screen.findAllByText(A);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(panelSpy).toHaveBeenLastCalledWith('xpath', B, 30, expect.any(Number)),
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
  });

  it('refreshes the list after an action, and keeps the panel open on the new status', async () => {
    vi.spyOn(XenonApiService, 'postSelectorStateAction').mockResolvedValue({ state: null });
    renderPage(`/selector-health?strategy=xpath&selector=${encodeURIComponent(A)}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Mute…' }));
    listSpy.mockResolvedValue({
      ...LIST,
      total: 1,
      items: [item(B, 2)],
      counts: { ...LIST.counts, fix: 1, muted: 1 },
    });
    panelSpy.mockResolvedValue({
      status: 200,
      body: {
        ...detailFor(A),
        state: {
          status: 'muted',
          cleanBuilds: 0,
          fixedAt: null,
          fixedBy: null,
          resolvedAt: null,
          mutedAt: new Date().toISOString(),
          mutedBy: { id: 'u-1', name: 'Priya' },
          muteReason: null,
          brokeAgain: 0,
        },
      },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mute' }));

    const panel = await screen.findByRole('complementary', { name: 'Selector details' });
    await waitFor(() => expect(within(panel).getByText('Muted')).toBeTruthy());
    await waitFor(() => expect(screen.queryAllByRole('row')).toHaveLength(2));
    expect(within(screen.getAllByRole('row')[1]).queryByText(A)).toBeNull();
  });

  it('goes from a broke-again note to that selector, in the same period and order', async () => {
    renderPage('/selector-health?tab=fixed&days=7&sort=time&q=cart&page=2');
    await waitFor(() => expect(listSpy).toHaveBeenCalled());
    emit('selector_regressed', { original_strategy: 'xpath', original_selector: A });
    fireEvent.click(await screen.findByRole('button', { name: 'Show selectors to fix' }));
    expect(screen.getByTestId('where').textContent).toBe(
      `/selector-health?days=7&sort=time&strategy=xpath&selector=${encodeURIComponent(A)}`,
    );
  });

  it('opens an old detail link in the panel', async () => {
    renderPage(`/selector-health/detail?value=${encodeURIComponent(A)}&strategy=xpath`);
    expect(await screen.findByRole('complementary', { name: 'Selector details' })).toBeTruthy();
  });

  it('uses no technical words, list and panel', async () => {
    renderPage(`/selector-health?strategy=xpath&selector=${encodeURIComponent(A)}`);
    await screen.findByRole('complementary', { name: 'Selector details' });
    await screen.findAllByText(A);
    expect(document.body.textContent ?? '').not.toMatch(JARGON);
  });
  it("says it couldn't load the selectors, never that there is nothing to fix", async () => {
    listSpy.mockRejectedValue(new Error('database is locked'));
    renderPage();
    expect(await screen.findByText(/Couldn't load selectors/)).toBeTruthy();
    expect(screen.queryByText(/Nothing to fix/)).toBeNull();
  });

  it('keeps the selectors it has when a refresh fails', async () => {
    vi.spyOn(XenonApiService, 'postSelectorStateAction').mockResolvedValue({ state: null });
    renderPage(`/selector-health?strategy=xpath&selector=${encodeURIComponent(A)}`);
    await screen.findAllByText(B);
    listSpy.mockRejectedValue(new Error('database is locked'));
    fireEvent.click(await screen.findByRole('button', { name: 'Mute…' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getAllByText(B).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Nothing to fix/)).toBeNull();
  });

  it("says the trend couldn't load when the summary fails", async () => {
    summarySpy.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/Couldn't load heals per day/)).toBeTruthy();
  });
});
