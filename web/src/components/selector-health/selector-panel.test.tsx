import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import XenonApiService from '../../api-service';
import { ISelectorDetailResponse, ISelectorStateView } from '../../interfaces/IHealingEvent';

const h = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../ui/toast', () => ({ useToast: () => ({ toast: h.toast }) }));

import { SelectorPanel } from './selector-panel';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 8, 30);

const DETAIL: ISelectorDetailResponse = {
  strategy: 'xpath',
  selector: '//a',
  days: 30,
  heals: 4,
  sessions: 2,
  timeSpentMs: 18000,
  firstHealedAt: new Date(t0).toISOString(),
  lastHealedAt: new Date(t0 + DAY).toISOString(),
  daily: [
    { t: t0, heals: 1 },
    { t: t0 + DAY, heals: 3 },
  ],
  suggestions: [
    {
      selector: '//fix',
      strategy: 'xpath',
      count: 3,
      share: 0.75,
      methods: ['Visual AI'],
      averageConfidence: 0.9,
    },
    {
      selector: 'confirm',
      strategy: 'accessibility id',
      count: 1,
      share: 0.25,
      methods: ['LLM'],
      averageConfidence: 0.5,
    },
  ],
  platforms: [{ name: 'android', count: 4 }],
  builds: [
    { id: 'b1', name: 'nightly-2026-10-01', count: 3 },
    { id: null, name: 'No build', count: 1 },
  ],
  devices: [{ udid: 'p1', name: 'Shared Pixel', count: 4 }],
  recent: [
    {
      id: 'r1',
      sessionId: 's1',
      buildId: null,
      at: new Date().toISOString(),
      device: 'Shared Pixel',
      platform: 'android',
      method: 'LLM',
      confidence: 0.5,
      healedSelector: 'confirm',
    },
  ],
  state: null,
  activity: [
    {
      action: 'muted',
      at: '2026-09-12T10:00:00Z',
      by: { id: 'u-gone', name: null },
      reason: 'Redesign',
    },
  ],
  canAct: true,
};

const pending: ISelectorStateView = {
  status: 'pending',
  cleanBuilds: 2,
  fixedAt: new Date().toISOString(),
  fixedBy: { id: 'u', name: 'Priya' },
  resolvedAt: null,
  mutedAt: null,
  mutedBy: null,
  muteReason: null,
  brokeAgain: 0,
};

function renderPanel(over: Partial<ISelectorDetailResponse> = {}, status = 200) {
  vi.spyOn(XenonApiService, 'getSelectorPanel').mockResolvedValue({
    status,
    body: status === 200 ? { ...DETAIL, ...over } : null,
  });
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <SelectorPanel
        target={{ strategy: 'xpath', selector: '//a' }}
        days={30}
        tz={0}
        refreshKey={0}
        onClose={onClose}
        onChanged={onChanged}
      />
    </MemoryRouter>,
  );
  return { onChanged, onClose };
}

describe('SelectorPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    h.toast.mockReset();
  });

  it('shows the selector, its status and every section', async () => {
    renderPanel();
    expect(await screen.findByText('//fix')).toBeTruthy();
    const panel = screen.getByRole('complementary', { name: 'Selector details' });
    expect(within(panel).getByText('To fix')).toBeTruthy();
    expect(within(panel).getByText(/75% of heals/)).toBeTruthy();
    expect(within(panel).getByText('18 s')).toBeTruthy();
    expect(within(panel).getByText('nightly-2026-10-01')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'Session' }).getAttribute('href')).toBe(
      '/builds/none/sessions/s1',
    );
  });

  it('shows an action by someone the server no longer knows without a name or an id', async () => {
    renderPanel();
    const activity = await screen.findByRole('region', { name: 'Activity' });
    expect(activity.textContent).toContain('Muted');
    expect(activity.textContent).toContain('Redesign');
    expect(activity.textContent).not.toContain('u-gone');
  });

  it('hides the actions from someone who may not act', async () => {
    renderPanel({ canAct: false });
    await screen.findByText('//fix');
    expect(screen.queryByRole('button', { name: 'Mark fixed' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mute…' })).toBeNull();
  });

  it('offers the actions that fit the status', async () => {
    renderPanel({ state: pending });
    expect(await screen.findByRole('button', { name: 'Cancel verification' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark fixed' })).toBeNull();
    expect(screen.getByText('Being verified, 2 of 3 clean builds')).toBeTruthy();
  });

  it('marks fixed after confirming, then tells the page', async () => {
    const post = vi
      .spyOn(XenonApiService, 'postSelectorStateAction')
      .mockResolvedValue({ state: null });
    const { onChanged } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark fixed' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark fixed' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith({
      original_strategy: 'xpath',
      original_selector: '//a',
      action: 'mark_fixed',
    });
    expect(h.toast).toHaveBeenCalledWith(
      'Marked fixed. Xenon is watching the next 3 clean builds.',
      'success',
    );
  });

  it('mutes with the reason given', async () => {
    const post = vi
      .spyOn(XenonApiService, 'postSelectorStateAction')
      .mockResolvedValue({ state: null });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Mute…' }));
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Redesign' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mute' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith({
        original_strategy: 'xpath',
        original_selector: '//a',
        action: 'mute',
        reason: 'Redesign',
      }),
    );
  });

  it('says plainly when someone changed the selector first, and refreshes', async () => {
    vi.spyOn(XenonApiService, 'postSelectorStateAction').mockRejectedValue(
      Object.assign(new Error('Cannot markFixed on a muted selector (xpath=//a)'), { status: 409 }),
    );
    const { onChanged } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark fixed' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark fixed' }));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        'Someone changed this selector just now. It has been refreshed.',
        'error',
      ),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("says a selector isn't available when the server doesn't know it", async () => {
    renderPanel({}, 404);
    expect(await screen.findByText(/This selector isn't available/)).toBeTruthy();
  });

  it('says when there were no heals in the period', async () => {
    renderPanel({
      heals: 0,
      suggestions: [],
      recent: [],
      daily: [],
      platforms: [],
      builds: [],
      devices: [],
    });
    expect(await screen.findByText('No heals in the last 30 days.')).toBeTruthy();
  });
});
