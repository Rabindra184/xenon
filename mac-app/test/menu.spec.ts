import { describe, expect, it, vi } from 'vitest';
import { buildMenuTemplate, stopServerEnabled, trayStatusLabel } from '../src/main/menu';

/* eslint-disable @typescript-eslint/no-explicit-any */
// The options every call needs besides the ones a test is about.
const prefsOpts = { appearance: 'system' as const, setPrefs: vi.fn() };

function flat(items: any[]): any[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])]);
}

describe('buildMenuTemplate', () => {
  it('wires shortcuts to menu actions', () => {
    const send = vi.fn();
    const items = flat(buildMenuTemplate({ serverStatus: 'stopped', hasDashboard: false, send, ...prefsOpts }) as any[]);
    const byLabel = Object.fromEntries(items.filter((i) => i.label).map((i) => [i.label, i]));
    expect(byLabel['New Profile'].accelerator).toBe('Cmd+N');
    expect(byLabel['Start Server'].accelerator).toBe('Cmd+Return');
    expect(byLabel['Settings'].accelerator).toBe('Cmd+1');
    expect(byLabel['Logs'].accelerator).toBe('Cmd+4');
    byLabel['New Profile'].click();
    expect(send).toHaveBeenCalledWith('new-profile');
  });

  it('puts Manage Profiles… in the File menu, after Export Profile…', () => {
    const send = vi.fn();
    const template = buildMenuTemplate({ serverStatus: 'stopped', hasDashboard: false, send, ...prefsOpts }) as any[];
    const file = template.find((i) => i.label === 'File');
    const labels = file.submenu.filter((i: any) => i.label).map((i: any) => i.label);
    expect(labels).toEqual(['New Profile', 'Import Profiles…', 'Export Profile…', 'Manage Profiles…']);
    file.submenu.find((i: any) => i.label === 'Manage Profiles…').click();
    expect(send).toHaveBeenCalledWith('manage-profiles');
  });

  it('disables dashboard when not running and flips Start/Stop label', () => {
    const send = vi.fn();
    const stopped = flat(buildMenuTemplate({ serverStatus: 'stopped', hasDashboard: false, send, ...prefsOpts }) as any[]);
    expect(stopped.find((i) => i.label === 'Open Dashboard').enabled).toBe(false);
    expect(stopped.find((i) => i.label === 'Start Server')).toBeTruthy();

    const running = flat(buildMenuTemplate({ serverStatus: 'running', hasDashboard: true, send, ...prefsOpts }) as any[]);
    expect(running.find((i) => i.label === 'Stop Server')).toBeTruthy();
    expect(running.find((i) => i.label === 'Open Dashboard').enabled).toBe(true);
    expect(running.find((i) => i.label === 'Launch Preview').enabled).toBe(false);
  });

  it('keeps the Start/Stop item enabled except while a stop is already under way', () => {
    const item = (serverStatus: Parameters<typeof buildMenuTemplate>[0]['serverStatus']) =>
      flat(buildMenuTemplate({ serverStatus, hasDashboard: false, send: vi.fn(), ...prefsOpts }) as any[]).find(
        (i) => i.label === 'Start Server' || i.label === 'Stop Server'
      );
    expect(item('stopped')).toMatchObject({ label: 'Start Server', enabled: true });
    expect(item('crashed')).toMatchObject({ label: 'Start Server', enabled: true });
    expect(item('starting')).toMatchObject({ label: 'Stop Server', enabled: true });
    expect(item('running')).toMatchObject({ label: 'Stop Server', enabled: true });
    expect(item('stopping')).toMatchObject({ label: 'Stop Server', enabled: false });
  });
});

describe('buildMenuTemplate Appearance', () => {
  const viewItems = (appearance: 'system' | 'light' | 'dark', setPrefs = vi.fn()) => {
    const template = buildMenuTemplate({
      serverStatus: 'stopped',
      hasDashboard: false,
      send: vi.fn(),
      appearance,
      setPrefs
    }) as any[];
    const view = template.find((i) => i.label === 'View');
    const appearanceItem = view.submenu.find((i: any) => i.label === 'Appearance');
    return { view, appearanceItem };
  };

  it('puts Appearance in View with System, Light and Dark', () => {
    const { appearanceItem } = viewItems('system');
    expect(appearanceItem).toBeTruthy();
    expect(appearanceItem.submenu.map((i: any) => i.label)).toEqual(['System', 'Light', 'Dark']);
    expect(appearanceItem.submenu.every((i: any) => i.type === 'radio')).toBe(true);
  });

  it('checks only the current appearance', () => {
    for (const [appearance, label] of [
      ['system', 'System'],
      ['light', 'Light'],
      ['dark', 'Dark']
    ] as const) {
      const checked = viewItems(appearance).appearanceItem.submenu.filter((i: any) => i.checked);
      expect(checked.map((i: any) => i.label)).toEqual([label]);
    }
  });

  it('sets the appearance when an item is clicked', () => {
    const setPrefs = vi.fn();
    const { appearanceItem } = viewItems('dark', setPrefs);
    const byLabel = (l: string) => appearanceItem.submenu.find((i: any) => i.label === l);
    byLabel('Light').click();
    expect(setPrefs).toHaveBeenLastCalledWith({ appearance: 'light' });
    byLabel('System').click();
    expect(setPrefs).toHaveBeenLastCalledWith({ appearance: 'system' });
    byLabel('Dark').click();
    expect(setPrefs).toHaveBeenLastCalledWith({ appearance: 'dark' });
  });

  it('keeps the existing View items and their shortcuts', () => {
    const { view } = viewItems('system');
    const labels = view.submenu.filter((i: any) => i.accelerator).map((i: any) => [i.label, i.accelerator]);
    expect(labels).toEqual([
      ['Settings', 'Cmd+1'],
      ['Secrets & Env', 'Cmd+2'],
      ['Health', 'Cmd+3'],
      ['Logs', 'Cmd+4']
    ]);
  });
});

describe('stopServerEnabled (tray)', () => {
  it('is on while starting or running and off otherwise, including while stopping', () => {
    expect(stopServerEnabled('starting')).toBe(true);
    expect(stopServerEnabled('running')).toBe(true);
    expect(stopServerEnabled('stopping')).toBe(false);
    expect(stopServerEnabled('stopped')).toBe(false);
    expect(stopServerEnabled('crashed')).toBe(false);
  });
});

describe('trayStatusLabel', () => {
  it('names every server state, including stopping', () => {
    expect(trayStatusLabel({ status: 'running', port: 4723 })).toBe('Xenon: running (:4723)');
    expect(trayStatusLabel({ status: 'starting', port: 4723 })).toBe('Xenon: starting…');
    expect(trayStatusLabel({ status: 'stopping', port: 4723 })).toBe('Xenon: stopping…');
    expect(trayStatusLabel({ status: 'crashed', port: null })).toBe('Xenon: crashed');
    expect(trayStatusLabel({ status: 'stopped', port: null })).toBe('Xenon: stopped');
  });
});
