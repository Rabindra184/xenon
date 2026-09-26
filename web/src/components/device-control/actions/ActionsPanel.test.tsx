import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ swipe: vi.fn(), listApps: vi.fn() }));
const toast = vi.hoisted(() => vi.fn(() => 't'));
vi.mock('../../../api-service', () => ({ default: api }));
vi.mock('../../ui/toast', () => ({ useToast: () => ({ toast, removeToast: vi.fn() }) }));

import { ActionsPanel } from './ActionsPanel';

const open = () =>
  render(
    <MemoryRouter>
      <ActionsPanel
        udid="U1"
        platform="android"
        deviceName="Galaxy S9+"
        screenWidth={1000}
        screenHeight={2000}
      />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.listApps.mockResolvedValue([]);
  api.swipe.mockResolvedValue({});
});

describe('ActionsPanel', () => {
  it('shows the three sections in order', () => {
    open();
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent?.trim())).toEqual([
      'Apps',
      'Text and clipboard',
      'Swipe',
    ]);
  });

  it('swipes through the screen centre, and says why a swipe failed', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Swipe up' }));
    await waitFor(() => expect(api.swipe).toHaveBeenCalledWith('U1', 500, 1800, 500, 200));
    api.swipe.mockRejectedValue(new Error('stream stopped'));
    fireEvent.click(screen.getByRole('button', { name: 'Swipe left' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Couldn’t swipe left: stream stopped', 'error'),
    );
  });
});
