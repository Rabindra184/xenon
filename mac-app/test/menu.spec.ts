import { describe, expect, it, vi } from 'vitest';
import { buildMenuTemplate, trayMenuTemplate, trayStatusLabel } from '../src/main/menu';
import { APPEARANCES } from '../src/shared/preferences';
import { STATUS_WORD } from '../src/shared/statusWords';
import type { ServerStatus } from '../src/shared/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Options = Parameters<typeof buildMenuTemplate>[0];

/** The menu for a stopped server, technical details off, with `over` laid on top. */
function template(over: Partial<Options> = {}): any[] {
  return buildMenuTemplate({
    serverStatus: 'stopped',
    hasDashboard: false,
    technicalDetails: false,
    appearance: 'system',
    send: vi.fn(),
    setPrefs: vi.fn(),
    ...over
  }) as any[];
}

/** A top-level menu's items. */
const menu = (items: any[], label: string): any[] => items.find((i) => i.label === label).submenu;

/** [label or role, accelerator] for every item of a menu, a separator as '—'. */
const outline = (items: any[]) => items.map((i) => (i.type === 'separator' ? '—' : [i.label ?? i.role, i.accelerator]));

const item = (items: any[], label: string) => items.find((i) => i.label === label);

describe('buildMenuTemplate: File', () => {
  it('has New Profile ⌘N, Import Profiles…, Export Profile… and Manage Profiles…', () => {
    expect(outline(menu(template(), 'File'))).toEqual([
      ['New Profile', 'Cmd+N'],
      ['Import Profiles…', undefined],
      ['Export Profile…', undefined],
      ['Manage Profiles…', undefined],
      '—',
      ['close', undefined]
    ]);
  });

  it('sends each item’s action', () => {
    const send = vi.fn();
    const file = menu(template({ send }), 'File');
    for (const [label, action] of [
      ['New Profile', 'new-profile'],
      ['Import Profiles…', 'import-profiles'],
      ['Export Profile…', 'export-profile'],
      ['Manage Profiles…', 'manage-profiles']
    ]) {
      item(file, label).click();
      expect(send).toHaveBeenLastCalledWith(action);
    }
  });
});

describe('buildMenuTemplate: Server', () => {
  it('with technical details off: Start Server ⌘⏎, Open Dashboard ⌘D and Copy Test Address ⇧⌘C, nothing technical', () => {
    const server = menu(template(), 'Server');
    expect(outline(server)).toEqual([
      ['Start Server', 'Cmd+Return'],
      ['Open Dashboard', 'Cmd+D'],
      ['Copy Test Address', 'Shift+Cmd+C']
    ]);
    expect(item(server, 'Preview Launch…')).toBeUndefined();
    expect(item(server, 'Export Config…')).toBeUndefined();
  });

  it('with technical details on: a separator, Preview Launch… ⌘P and Export Config…', () => {
    expect(outline(menu(template({ technicalDetails: true }), 'Server'))).toEqual([
      ['Start Server', 'Cmd+Return'],
      ['Open Dashboard', 'Cmd+D'],
      ['Copy Test Address', 'Shift+Cmd+C'],
      '—',
      ['Preview Launch…', 'Cmd+P'],
      ['Export Config…', undefined]
    ]);
  });

  it('says Stop Server while the server is active, on the same shortcut', () => {
    for (const serverStatus of ['starting', 'running', 'stopping'] as const) {
      expect(item(menu(template({ serverStatus }), 'Server'), 'Stop Server')).toMatchObject({ accelerator: 'Cmd+Return' });
    }
    for (const serverStatus of ['stopped', 'crashed'] as const) {
      expect(item(menu(template({ serverStatus }), 'Server'), 'Start Server')).toMatchObject({ accelerator: 'Cmd+Return' });
    }
  });

  it('keeps Start/Stop enabled except while a stop is already under way', () => {
    const startStop = (serverStatus: ServerStatus) =>
      menu(template({ serverStatus }), 'Server').find((i) => i.label === 'Start Server' || i.label === 'Stop Server');
    expect(startStop('stopped')).toMatchObject({ label: 'Start Server', enabled: true });
    expect(startStop('crashed')).toMatchObject({ label: 'Start Server', enabled: true });
    expect(startStop('starting')).toMatchObject({ label: 'Stop Server', enabled: true });
    expect(startStop('running')).toMatchObject({ label: 'Stop Server', enabled: true });
    expect(startStop('stopping')).toMatchObject({ label: 'Stop Server', enabled: false });
  });

  it('enables Open Dashboard only when there is a dashboard', () => {
    expect(item(menu(template({ hasDashboard: false }), 'Server'), 'Open Dashboard').enabled).toBe(false);
    const running = template({ serverStatus: 'running', hasDashboard: true });
    expect(item(menu(running, 'Server'), 'Open Dashboard').enabled).toBe(true);
  });

  // While nothing runs it copies the open profile's address, so it is never off.
  it('keeps Copy Test Address enabled whatever the server is doing', () => {
    for (const serverStatus of ['stopped', 'starting', 'running', 'stopping', 'crashed'] as const) {
      expect(item(menu(template({ serverStatus }), 'Server'), 'Copy Test Address').enabled).not.toBe(false);
    }
  });

  it('enables Preview Launch… only while the server is not active', () => {
    const preview = (serverStatus: ServerStatus) =>
      item(menu(template({ serverStatus, technicalDetails: true }), 'Server'), 'Preview Launch…');
    expect(preview('stopped').enabled).toBe(true);
    expect(preview('crashed').enabled).toBe(true);
    expect(preview('starting').enabled).toBe(false);
    expect(preview('running').enabled).toBe(false);
    expect(preview('stopping').enabled).toBe(false);
  });

  it('sends each item’s action', () => {
    const send = vi.fn();
    const server = menu(template({ send, technicalDetails: true, hasDashboard: true }), 'Server');
    for (const [label, action] of [
      ['Start Server', 'toggle-server'],
      ['Open Dashboard', 'open-dashboard'],
      ['Copy Test Address', 'copy-test-address'],
      ['Preview Launch…', 'launch-preview'],
      ['Export Config…', 'export-config']
    ]) {
      item(server, label).click();
      expect(send).toHaveBeenLastCalledWith(action);
    }
  });
});

describe('buildMenuTemplate: View', () => {
  it('has the four places on ⌘1–⌘4, a separator, Appearance and Show Technical Details ⌥⌘T', () => {
    expect(outline(menu(template(), 'View'))).toEqual([
      ['Home', 'Cmd+1'],
      ['Setup', 'Cmd+2'],
      ['Settings', 'Cmd+3'],
      ['Logs', 'Cmd+4'],
      '—',
      ['Appearance', undefined],
      ['Show Technical Details', 'Alt+Cmd+T']
    ]);
  });

  it('opens each place', () => {
    const send = vi.fn();
    const view = menu(template({ send }), 'View');
    for (const [label, action] of [
      ['Home', 'place-home'],
      ['Setup', 'place-setup'],
      ['Settings', 'place-settings'],
      ['Logs', 'place-logs']
    ]) {
      item(view, label).click();
      expect(send).toHaveBeenLastCalledWith(action);
    }
  });

  it('shows technical details as a checkbox, checked when they are on', () => {
    expect(item(menu(template({ technicalDetails: false }), 'View'), 'Show Technical Details')).toMatchObject({
      type: 'checkbox',
      checked: false
    });
    expect(item(menu(template({ technicalDetails: true }), 'View'), 'Show Technical Details')).toMatchObject({
      type: 'checkbox',
      checked: true
    });
  });

  it('turns technical details the other way when clicked, and changes nothing else', () => {
    const setPrefs = vi.fn();
    item(menu(template({ technicalDetails: false, setPrefs }), 'View'), 'Show Technical Details').click();
    expect(setPrefs).toHaveBeenLastCalledWith({ technicalDetails: true });
    item(menu(template({ technicalDetails: true, setPrefs }), 'View'), 'Show Technical Details').click();
    expect(setPrefs).toHaveBeenLastCalledWith({ technicalDetails: false });
    expect(setPrefs).toHaveBeenCalledTimes(2);
  });
});

describe('buildMenuTemplate: Appearance', () => {
  const appearanceItems = (appearance: 'system' | 'light' | 'dark', setPrefs = vi.fn()): any[] =>
    item(menu(template({ appearance, setPrefs }), 'View'), 'Appearance').submenu;

  it('lists System, Light and Dark as radios', () => {
    const items = appearanceItems('system');
    expect(items.map((i) => i.label)).toEqual(['System', 'Light', 'Dark']);
    expect(items.every((i) => i.type === 'radio')).toBe(true);
  });

  it('has one item for each appearance the preferences know, in their order', () => {
    const setPrefs = vi.fn();
    const items = appearanceItems('system', setPrefs);
    expect(items).toHaveLength(APPEARANCES.length);
    items.forEach((i) => i.click());
    expect(setPrefs.mock.calls.map(([patch]) => patch.appearance)).toEqual([...APPEARANCES]);
  });

  it('checks only the current appearance', () => {
    for (const [appearance, label] of [
      ['system', 'System'],
      ['light', 'Light'],
      ['dark', 'Dark']
    ] as const) {
      const checked = appearanceItems(appearance).filter((i) => i.checked);
      expect(checked.map((i) => i.label)).toEqual([label]);
    }
  });

  it('sets the appearance when an item is clicked', () => {
    const setPrefs = vi.fn();
    const items = appearanceItems('dark', setPrefs);
    const byLabel = (l: string) => items.find((i) => i.label === l);
    byLabel('Light').click();
    expect(setPrefs).toHaveBeenLastCalledWith({ appearance: 'light' });
    byLabel('System').click();
    expect(setPrefs).toHaveBeenLastCalledWith({ appearance: 'system' });
    byLabel('Dark').click();
    expect(setPrefs).toHaveBeenLastCalledWith({ appearance: 'dark' });
  });
});

describe('trayMenuTemplate', () => {
  type TrayOptions = Parameters<typeof trayMenuTemplate>[0];
  const tray = (over: Partial<TrayOptions> = {}): any[] =>
    trayMenuTemplate({
      serverStatus: 'stopped',
      port: null,
      hasDashboard: false,
      send: vi.fn(),
      show: vi.fn(),
      stop: vi.fn(),
      quit: vi.fn(),
      ...over
    }) as any[];
  const labels = (items: any[]) => items.filter((i) => i.type !== 'separator').map((i) => i.label);
  const toggle = (items: any[]) => items.find((i) => i.label === 'Start Server' || i.label === 'Stop Server');

  it('lists the status line, Start Server, Open Dashboard, Copy Test Address, Show Xenon Control and Quit Xenon Control, in order', () => {
    expect(labels(tray())).toEqual([
      'Stopped',
      'Start Server',
      'Open Dashboard',
      'Copy Test Address',
      'Show Xenon Control',
      'Quit Xenon Control'
    ]);
  });

  it('starts with the status line, which cannot be clicked', () => {
    expect(tray({ serverStatus: 'running', port: 4799 })[0]).toMatchObject({
      label: 'Running · port 4799',
      enabled: false
    });
  });

  it('says Stop Server while the server is active, and is off while a stop is under way', () => {
    expect(toggle(tray({ serverStatus: 'stopped' }))).toMatchObject({ label: 'Start Server', enabled: true });
    expect(toggle(tray({ serverStatus: 'crashed' }))).toMatchObject({ label: 'Start Server', enabled: true });
    expect(toggle(tray({ serverStatus: 'starting' }))).toMatchObject({ label: 'Stop Server', enabled: true });
    expect(toggle(tray({ serverStatus: 'running' }))).toMatchObject({ label: 'Stop Server', enabled: true });
    expect(toggle(tray({ serverStatus: 'stopping' }))).toMatchObject({ label: 'Stop Server', enabled: false });
  });

  // A Start the window acts on later (it may be opening) must never become a Stop, so the tray
  // sends 'start-server', which only ever starts, rather than the app menu's toggle.
  it('shows the window before it starts the server, so a start that is blocked is seen', () => {
    const calls: string[] = [];
    const items = tray({
      show: () => calls.push('show'),
      send: (a) => calls.push(`send:${a}`),
      stop: () => calls.push('stop')
    });
    toggle(items).click();
    expect(calls).toEqual(['show', 'send:start-server']);
  });

  // Ruling R20: Stop needs nothing from the window, so it stops the server directly, as Part A did.
  it('stops the server directly, without the window', () => {
    for (const serverStatus of ['starting', 'running'] as const) {
      const calls: string[] = [];
      const items = tray({
        serverStatus,
        show: () => calls.push('show'),
        send: (a) => calls.push(`send:${a}`),
        stop: () => calls.push('stop')
      });
      toggle(items).click();
      expect(calls).toEqual(['stop']);
    }
  });

  it('opens the dashboard only when there is one', () => {
    const send = vi.fn();
    expect(tray().find((i) => i.label === 'Open Dashboard').enabled).toBe(false);
    const dashboard = tray({ serverStatus: 'running', port: 4799, hasDashboard: true, send }).find(
      (i) => i.label === 'Open Dashboard'
    );
    expect(dashboard.enabled).toBe(true);
    dashboard.click();
    expect(send).toHaveBeenCalledWith('open-dashboard');
  });

  it('Copy Test Address asks the window to copy it, whatever the server is doing', () => {
    for (const serverStatus of ['stopped', 'starting', 'running', 'stopping', 'crashed'] as const) {
      const send = vi.fn();
      const copy = tray({ serverStatus, port: 4799, send }).find((i) => i.label === 'Copy Test Address');
      expect(copy.enabled).not.toBe(false);
      copy.click();
      expect(send).toHaveBeenCalledWith('copy-test-address');
    }
  });

  it('Show Xenon Control shows the window; Quit Xenon Control quits', () => {
    const show = vi.fn();
    const quit = vi.fn();
    const items = tray({ show, quit });
    items.find((i) => i.label === 'Show Xenon Control').click();
    expect(show).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
    items.find((i) => i.label === 'Quit Xenon Control').click();
    expect(quit).toHaveBeenCalledTimes(1);
  });
});

describe('trayStatusLabel', () => {
  // The menu-bar icon says what the window's sidebar says, in the same words.
  it('names every server state in the window’s words, with the port while running', () => {
    expect(trayStatusLabel({ status: 'running', port: 4723 })).toBe('Running · port 4723');
    expect(trayStatusLabel({ status: 'starting', port: 4723 })).toBe('Starting…');
    expect(trayStatusLabel({ status: 'stopping', port: 4723 })).toBe('Stopping…');
    expect(trayStatusLabel({ status: 'crashed', port: null })).toBe('Stopped unexpectedly');
    expect(trayStatusLabel({ status: 'stopped', port: null })).toBe('Stopped');
  });

  it('starts with the sidebar’s word for each status', () => {
    for (const status of Object.keys(STATUS_WORD) as ServerStatus[]) {
      expect(trayStatusLabel({ status, port: 4799 }).startsWith(STATUS_WORD[status])).toBe(true);
    }
  });

  it('leaves the port out when it is not known', () => {
    expect(trayStatusLabel({ status: 'running', port: null })).toBe('Running');
  });
});
