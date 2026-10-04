import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from './settings';
import { MaintenanceSettings } from './maintenance-settings';
import { ToastProvider } from '../ui/toast';
import XenonApiService from '../../api-service';

/**
 * The settings pages used to carry their own copies of the server's defaults,
 * and the Settings page's was wrong: it showed 30000 ms for the idle health
 * check while the server runs one every 300000 ms, so saving the number it
 * showed made checks ten times more frequent. The server now sends its
 * defaults with the settings (GET /config `defaults`), the pages show what
 * the server runs with, and a save sends only what the person changed, so an
 * untouched setting is not frozen as a dashboard value that would hide a later
 * change to the server's own configuration.
 */

vi.mock('../../hooks/useSocket', () => ({
  useSocket: () => ({ on: () => () => undefined }),
}));

vi.mock('../../api-service', () => ({
  default: {
    getGlobalConfig: vi.fn(),
    updateGlobalConfig: vi.fn().mockResolvedValue({ success: true }),
    getRecentHealingEvents: vi.fn().mockResolvedValue({ events: [] }),
    resetMetrics: vi.fn().mockResolvedValue({ success: true }),
  },
}));

const SERVER_DEFAULTS = {
  healthCheckIntervalMs: 300000,
  enableSelfHealing: true,
  buildCleanupDays: 45,
  buildCleanupMaxCount: 250,
  buildCleanupSchedule: '0 4 * * *',
  deleteBuildAssets: false,
};

const api = () => vi.mocked(XenonApiService);

function renderPage(page: 'settings' | 'maintenance') {
  return render(
    <MemoryRouter>
      <ToastProvider>{page === 'settings' ? <Settings /> : <MaintenanceSettings />}</ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api().getGlobalConfig.mockResolvedValue({ defaults: SERVER_DEFAULTS });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Settings page', () => {
  it("shows the server's health-check interval, not a number of its own", async () => {
    renderPage('settings');
    expect(await screen.findByDisplayValue('300000')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('30000')).not.toBeInTheDocument();
  });

  it('shows the interval the server runs with when it differs from the default', async () => {
    api().getGlobalConfig.mockResolvedValue({
      healthCheckIntervalMs: 600000,
      defaults: SERVER_DEFAULTS,
    });
    renderPage('settings');
    expect(await screen.findByDisplayValue('600000')).toBeInTheDocument();
  });

  it("restores the server's default interval, and says which", async () => {
    api().getGlobalConfig.mockResolvedValue({
      healthCheckIntervalMs: 600000,
      defaults: SERVER_DEFAULTS,
    });
    renderPage('settings');
    const input = await screen.findByDisplayValue('600000');
    fireEvent.change(input, { target: { value: '120000' } });
    fireEvent.click(await screen.findByRole('button', { name: /restore defaults/i }));

    expect(await screen.findByText(/300,000 ms/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));

    await waitFor(() => expect(api().updateGlobalConfig).toHaveBeenCalled());
    expect(api().updateGlobalConfig.mock.calls[0][0]).toMatchObject({
      healthCheckIntervalMs: 300000,
      healthCheckSchedule: '',
    });
  });

  it('saves only the setting that was changed', async () => {
    api().getGlobalConfig.mockResolvedValue({
      healthCheckIntervalMs: 300000,
      defaults: SERVER_DEFAULTS,
    });
    renderPage('settings');
    const schedule = await screen.findByPlaceholderText(/hourly/i);
    fireEvent.change(schedule, { target: { value: '0 * * * *' } });
    fireEvent.click(await screen.findByRole('button', { name: /save configuration/i }));

    await waitFor(() => expect(api().updateGlobalConfig).toHaveBeenCalled());
    expect(api().updateGlobalConfig.mock.calls[0][0]).toEqual({ healthCheckSchedule: '0 * * * *' });
  });

  describe('AI self-healing', () => {
    const healingSwitch = () => screen.findByRole('checkbox', { name: /toggle ai self-healing/i });

    it('shows Disabled, with the switch off, when the lab saved it off', async () => {
      api().getGlobalConfig.mockResolvedValue({
        healthCheckIntervalMs: 300000,
        enableSelfHealing: false,
        defaults: SERVER_DEFAULTS,
      });
      renderPage('settings');
      expect(await healingSwitch()).not.toBeChecked();
      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });

    it('shows Enabled, with the switch on, when the server runs with it on', async () => {
      api().getGlobalConfig.mockResolvedValue({
        healthCheckIntervalMs: 300000,
        enableSelfHealing: true,
        defaults: SERVER_DEFAULTS,
      });
      renderPage('settings');
      expect(await healingSwitch()).toBeChecked();
      expect(screen.getByText('Enabled')).toBeInTheDocument();
    });

    it('saves only the switch when only the switch was changed', async () => {
      api().getGlobalConfig.mockResolvedValue({
        healthCheckIntervalMs: 300000,
        enableSelfHealing: true,
        defaults: SERVER_DEFAULTS,
      });
      renderPage('settings');
      fireEvent.click(await healingSwitch());
      fireEvent.click(await screen.findByRole('button', { name: /save configuration/i }));

      await waitFor(() => expect(api().updateGlobalConfig).toHaveBeenCalled());
      expect(api().updateGlobalConfig.mock.calls[0][0]).toEqual({ enableSelfHealing: false });
    });

    it('saves only the switch when it is turned back on', async () => {
      api().getGlobalConfig.mockResolvedValue({
        healthCheckIntervalMs: 300000,
        enableSelfHealing: false,
        defaults: SERVER_DEFAULTS,
      });
      renderPage('settings');
      fireEvent.click(await healingSwitch());
      fireEvent.click(await screen.findByRole('button', { name: /save configuration/i }));

      await waitFor(() => expect(api().updateGlobalConfig).toHaveBeenCalled());
      expect(api().updateGlobalConfig.mock.calls[0][0]).toEqual({ enableSelfHealing: true });
    });

    it("restores the server's own default for the switch, not one the page carries", async () => {
      api().getGlobalConfig.mockResolvedValue({
        healthCheckIntervalMs: 300000,
        enableSelfHealing: true,
        defaults: { ...SERVER_DEFAULTS, enableSelfHealing: false },
      });
      renderPage('settings');
      fireEvent.click(await healingSwitch());
      fireEvent.click(await screen.findByRole('button', { name: /restore defaults/i }));
      fireEvent.click(await screen.findByRole('button', { name: 'Restore defaults' }));

      await waitFor(() => expect(api().updateGlobalConfig).toHaveBeenCalled());
      expect(api().updateGlobalConfig.mock.calls[0][0]).toMatchObject({
        enableSelfHealing: false,
      });
    });
  });

  it('does not show a form of invented numbers when the server cannot be reached', async () => {
    api().getGlobalConfig.mockRejectedValue(new Error('offline'));
    renderPage('settings');
    expect(await screen.findByText(/couldn.t load the settings/i)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('30000')).not.toBeInTheDocument();
  });
});

describe('Maintenance page', () => {
  it("shows the server's defaults for what was never saved", async () => {
    renderPage('maintenance');
    expect(await screen.findByDisplayValue('45')).toBeInTheDocument();
    expect(screen.getByDisplayValue('250')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0 4 * * *')).toBeInTheDocument();
  });

  it('shows the values the server runs with over its defaults', async () => {
    api().getGlobalConfig.mockResolvedValue({
      buildCleanupDays: 7,
      buildCleanupMaxCount: 20,
      buildCleanupSchedule: '0 2 * * 0',
      deleteBuildAssets: true,
      defaults: SERVER_DEFAULTS,
    });
    renderPage('maintenance');
    expect(await screen.findByDisplayValue('7')).toBeInTheDocument();
    expect(screen.getByDisplayValue('20')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0 2 * * 0')).toBeInTheDocument();
  });

  it('saves only the setting that was changed', async () => {
    api().getGlobalConfig.mockResolvedValue({
      buildCleanupDays: 7,
      buildCleanupMaxCount: 20,
      buildCleanupSchedule: '0 2 * * 0',
      deleteBuildAssets: true,
      defaults: SERVER_DEFAULTS,
    });
    renderPage('maintenance');
    const days = await screen.findByDisplayValue('7');
    fireEvent.change(days, { target: { value: '14' } });
    fireEvent.click(await screen.findByRole('button', { name: /save configuration/i }));

    await waitFor(() => expect(api().updateGlobalConfig).toHaveBeenCalled());
    expect(api().updateGlobalConfig.mock.calls[0][0]).toEqual({ buildCleanupDays: 14 });
  });

  it("restores the server's defaults", async () => {
    api().getGlobalConfig.mockResolvedValue({
      buildCleanupDays: 7,
      buildCleanupMaxCount: 20,
      buildCleanupSchedule: '0 2 * * 0',
      deleteBuildAssets: true,
      defaults: SERVER_DEFAULTS,
    });
    renderPage('maintenance');
    const days = await screen.findByDisplayValue('7');
    fireEvent.change(days, { target: { value: '14' } });
    fireEvent.click(await screen.findByRole('button', { name: /restore defaults/i }));

    await waitFor(() => expect(api().updateGlobalConfig).toHaveBeenCalled());
    expect(api().updateGlobalConfig.mock.calls[0][0]).toEqual({
      buildCleanupDays: 45,
      buildCleanupMaxCount: 250,
      buildCleanupSchedule: '0 4 * * *',
      deleteBuildAssets: false,
    });
  });

  it('tells the person a saved value replaces what the server started with', async () => {
    renderPage('maintenance');
    expect(
      await screen.findByText(/replace the values the server started with/i),
    ).toBeInTheDocument();
  });
});
