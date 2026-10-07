import type { MenuItemConstructorOptions } from 'electron';
import type { Appearance, Preferences } from '@shared/preferences';
import type { MenuAction, ServerState } from '@shared/types';

const APPEARANCE_CHOICES: ReadonlyArray<[Appearance, string]> = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark']
];

/**
 * Pure menu template builder — no Electron runtime needed, so it stays unit
 * testable. `send` pushes the action to the renderer, which owns all the state
 * these items act on.
 */
export function buildMenuTemplate(opts: {
  serverStatus: ServerState['status'];
  hasDashboard: boolean;
  send: (a: MenuAction) => void;
  /** The saved appearance choice, which the Appearance radios show. */
  appearance: Appearance;
  /** Saves a preference change; the main process then rebuilds this menu. */
  setPrefs: (patch: Partial<Preferences>) => void;
}): MenuItemConstructorOptions[] {
  const { serverStatus, hasDashboard, send, appearance, setPrefs } = opts;
  const active = serverStatus === 'running' || serverStatus === 'starting' || serverStatus === 'stopping';

  return [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Profile', accelerator: 'Cmd+N', click: () => send('new-profile') },
        { label: 'Import Profiles…', click: () => send('import-profiles') },
        { label: 'Export Profile…', click: () => send('export-profile') },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Server',
      submenu: [
        {
          label: active ? 'Stop Server' : 'Start Server',
          accelerator: 'Cmd+Return',
          // A Stop already under way does nothing more when pressed again.
          enabled: serverStatus !== 'stopping',
          click: () => send('toggle-server')
        },
        { label: 'Launch Preview', accelerator: 'Cmd+P', enabled: !active, click: () => send('launch-preview') },
        { label: 'Open Dashboard', accelerator: 'Cmd+D', enabled: hasDashboard, click: () => send('open-dashboard') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Settings', accelerator: 'Cmd+1', click: () => send('tab-settings') },
        { label: 'Secrets & Env', accelerator: 'Cmd+2', click: () => send('tab-secrets') },
        { label: 'Health', accelerator: 'Cmd+3', click: () => send('tab-health') },
        { label: 'Logs', accelerator: 'Cmd+4', click: () => send('tab-logs') },
        { type: 'separator' },
        {
          label: 'Appearance',
          submenu: APPEARANCE_CHOICES.map(([value, label]) => ({
            label,
            type: 'radio' as const,
            checked: appearance === value,
            click: () => setPrefs({ appearance: value })
          }))
        }
      ]
    },
    { role: 'windowMenu' }
  ];
}

/** Whether the tray's Stop Server item is usable: not while a stop is already under way. */
export function stopServerEnabled(status: ServerState['status']): boolean {
  return status === 'running' || status === 'starting';
}

/** The disabled status line at the top of the tray menu. */
export function trayStatusLabel(state: Pick<ServerState, 'status' | 'port'>): string {
  switch (state.status) {
    case 'running':
      return `Xenon: running (:${state.port})`;
    case 'starting':
      return 'Xenon: starting…';
    case 'stopping':
      return 'Xenon: stopping…';
    case 'crashed':
      return 'Xenon: crashed';
    default:
      return 'Xenon: stopped';
  }
}
