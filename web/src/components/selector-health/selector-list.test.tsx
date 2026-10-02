import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SEARCH_DELAY_MS, SelectorList } from './selector-list';
import { DEFAULT_VIEW, SelectorHealthView } from './view-state';
import {
  ISelectorListItem,
  ISelectorListResponse,
  ISelectorStateView,
} from '../../interfaces/IHealingEvent';

const HOT = '//android.widget.Button[@text="Confirm"]';
const FIX = "//android.widget.Button[@content-desc='Confirm order']";

const item = (over: Partial<ISelectorListItem> = {}): ISelectorListItem => ({
  strategy: 'xpath',
  selector: HOT,
  heals: 137,
  sessions: 48,
  lastHealedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  timeSpentMs: 60_000,
  topMethod: 'Visual AI',
  suggestion: { selector: FIX, strategy: 'xpath', share: 0.82 },
  state: null,
  ...over,
});

const state = (over: Partial<ISelectorStateView>): ISelectorStateView => ({
  status: 'active',
  cleanBuilds: 0,
  fixedAt: null,
  fixedBy: null,
  resolvedAt: null,
  mutedAt: null,
  mutedBy: null,
  muteReason: null,
  brokeAgain: 0,
  ...over,
});

const data = (over: Partial<ISelectorListResponse> = {}): ISelectorListResponse => ({
  tab: 'fix',
  days: 30,
  page: 1,
  pageSize: 50,
  total: 312,
  counts: { fix: 312, verifying: 2, fixed: 4, muted: 1 },
  canAct: true,
  items: [item(), item({ selector: '//b', heals: 2, sessions: 1 })],
  ...over,
});

function renderList(props: Partial<React.ComponentProps<typeof SelectorList>> = {}) {
  const onView = vi.fn();
  const onOpen = vi.fn();
  render(
    <SelectorList
      view={DEFAULT_VIEW}
      data={data()}
      loading={false}
      compact={false}
      selectedKey={null}
      onView={onView}
      onOpen={onOpen}
      {...props}
    />,
  );
  return { onView, onOpen };
}

const view = (over: Partial<SelectorHealthView>): SelectorHealthView => ({
  ...DEFAULT_VIEW,
  ...over,
});

describe('SelectorList', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows every tab with its count, the open one selected', () => {
    renderList();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'To fix312',
      'Being verified2',
      'Fixed4',
      'Muted1',
    ]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('switches tab, back to the first page', () => {
    const { onView } = renderList();
    fireEvent.click(screen.getByRole('tab', { name: /Muted/ }));
    expect(onView).toHaveBeenCalledWith({ tab: 'muted', page: 1 });
  });

  it('shows the selector and its suggested fix in full, with the share of heals', () => {
    renderList();
    expect(screen.getAllByText(HOT)[0].getAttribute('title')).toBe(HOT);
    expect(screen.getAllByText(FIX)[0]).toBeTruthy();
    expect(screen.getAllByText('82% of heals')[0]).toBeTruthy();
    expect(screen.getByText('48 sessions')).toBeTruthy();
    expect(screen.getAllByText('Visual AI')[0].getAttribute('title')).toBe(
      'Found it in a screenshot with AI',
    );
  });

  it('opens a row by click or by Enter', () => {
    const { onOpen } = renderList();
    const rows = screen.getAllByRole('row').slice(1);
    fireEvent.click(rows[0]);
    fireEvent.keyDown(rows[1], { key: 'Enter' });
    expect(onOpen.mock.calls).toEqual([
      [{ strategy: 'xpath', selector: HOT }],
      [{ strategy: 'xpath', selector: '//b' }],
    ]);
  });

  it('narrows to selector, heals and last healed beside the panel', () => {
    renderList({ compact: true });
    expect(screen.queryByText('Suggested fix')).toBeNull();
    expect(screen.queryByText('Healed by')).toBeNull();
    expect(screen.getByText('Last healed')).toBeTruthy();
  });

  it('marks a selector that broke again', () => {
    renderList({ data: data({ items: [item({ state: state({ brokeAgain: 2 }) })] }) });
    expect(screen.getByText('Broke again')).toBeTruthy();
  });

  it('searches after a pause, from the first page', () => {
    vi.useFakeTimers();
    const { onView } = renderList();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: 'confirm' },
    });
    expect(onView).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS);
    });
    expect(onView).toHaveBeenCalledWith({ q: 'confirm', page: 1 });
  });

  it('filters and sorts what to fix, and only that tab', () => {
    const { onView } = renderList();
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'time' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Platform' }), {
      target: { value: 'ios' },
    });
    expect(onView.mock.calls).toEqual([
      [{ sort: 'time', page: 1 }],
      [{ platform: 'ios', page: 1 }],
    ]);
  });

  it('has no filters or sort on a status tab', () => {
    renderList({ view: view({ tab: 'muted' }), data: data({ tab: 'muted' }) });
    expect(screen.queryByRole('combobox', { name: 'Sort' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Platform' })).toBeNull();
  });

  it('pages', () => {
    const { onView } = renderList();
    expect(screen.getByText('1–50 of 312')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onView).toHaveBeenCalledWith({ page: 2 });
  });

  it('shows who marked a selector fixed and how far its verification is', () => {
    renderList({
      view: view({ tab: 'verifying' }),
      data: data({
        tab: 'verifying',
        items: [
          item({
            state: state({
              status: 'pending',
              cleanBuilds: 2,
              fixedAt: new Date().toISOString(),
              fixedBy: { id: 'u', name: 'Priya' },
            }),
          }),
        ],
      }),
    });
    expect(screen.getByText('2 of 3 clean builds')).toBeTruthy();
    expect(screen.getByText(/by Priya/)).toBeTruthy();
  });

  it('shows who muted a selector, and why, never an id', () => {
    renderList({
      view: view({ tab: 'muted' }),
      data: data({
        tab: 'muted',
        items: [
          item({
            state: state({
              status: 'muted',
              mutedAt: '2026-09-12T10:00:00Z',
              mutedBy: { id: 'u-gone', name: null },
              muteReason: 'Screen being redesigned',
            }),
          }),
        ],
      }),
    });
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByText('Screen being redesigned')).toBeTruthy();
    expect(row.textContent).not.toContain('u-gone');
  });

  it('says what an empty tab means', () => {
    renderList({ data: data({ items: [], total: 0 }) });
    expect(screen.getByText('Nothing to fix in the last 30 days')).toBeTruthy();
  });

  it('says when a search found nothing', () => {
    renderList({ view: view({ q: 'zzz' }), data: data({ items: [], total: 0 }) });
    expect(screen.getByText('No selectors match “zzz”')).toBeTruthy();
  });
});
