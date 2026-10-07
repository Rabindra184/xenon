import type { MenuItemConstructorOptions } from 'electron';
import { APPEARANCES, type Appearance, type Preferences } from '@shared/preferences';
import type { MenuAction, ServerState, ServerStatus } from '@shared/types';

/** The words for each appearance. The choices themselves, and their order, are the preferences' own. */
const APPEARANCE_LABELS: Record<Appearance, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark'
};

/** Starting, running or stopping: Start Server reads Stop Server. */
const isActive = (status: ServerStatus): boolean =>
  status === 'running' || status === 'starting' || status === 'stopping';

/** Start Server or Stop Server, whichever the server needs. A stop already under way can't be pressed again. */
function startStopItem(serverStatus: ServerStatus, click: () => void): MenuItemConstructorOptions {
  return {
    label: isActive(serverStatus) ? 'Stop Server' : 'Start Server',
    enabled: serverStatus !== 'stopping',
    click
  };
}

/**
 * Pure menu template builder — no Electron runtime needed, so it stays unit
 * testable. `send` pushes the action to the renderer, which owns all the state
 * these items act on.
 */
export function buildMenuTemplate(opts: {
  serverStatus: ServerStatus;
  hasDashboard: boolean;
  /** Show technical details: the Server menu gains Preview Launch… and Export Config…, and View's checkbox is on. */
  technicalDetails: boolean;
  /** The saved appearance choice, which the Appearance radios show. */
  appearance: Appearance;
  send: (a: MenuAction) => void;
  /** Saves a preference change; the main process then rebuilds this menu. */
  setPrefs: (patch: Partial<Preferences>) => void;
}): MenuItemConstructorOptions[] {
  const { serverStatus, hasDashboard, technicalDetails, appearance, send, setPrefs } = opts;

  const technical: MenuItemConstructorOptions[] = technicalDetails
    ? [
        { type: 'separator' },
        {
          label: 'Preview Launch…',
          accelerator: 'Cmd+P',
          enabled: !isActive(serverStatus),
          click: () => send('launch-preview')
        },
        { label: 'Export Config…', click: () => send('export-config') }
      ]
    : [];

  return [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Profile', accelerator: 'Cmd+N', click: () => send('new-profile') },
        { label: 'Import Profiles…', click: () => send('import-profiles') },
        { label: 'Export Profile…', click: () => send('export-profile') },
        { label: 'Manage Profiles…', click: () => send('manage-profiles') },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Server',
      submenu: [
        { ...startStopItem(serverStatus, () => send('toggle-server')), accelerator: 'Cmd+Return' },
        { label: 'Open Dashboard', accelerator: 'Cmd+D', enabled: hasDashboard, click: () => send('open-dashboard') },
        ...technical
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Home', accelerator: 'Cmd+1', click: () => send('place-home') },
        { label: 'Setup', accelerator: 'Cmd+2', click: () => send('place-setup') },
        { label: 'Settings', accelerator: 'Cmd+3', click: () => send('place-settings') },
        { label: 'Logs', accelerator: 'Cmd+4', click: () => send('place-logs') },
        { type: 'separator' },
        {
          label: 'Appearance',
          submenu: APPEARANCES.map((value) => ({
            label: APPEARANCE_LABELS[value],
            type: 'radio' as const,
            checked: appearance === value,
            click: () => setPrefs({ appearance: value })
          }))
        },
        {
          label: 'Show Technical Details',
          accelerator: 'Alt+Cmd+T',
          type: 'checkbox',
          checked: technicalDetails,
          click: () => setPrefs({ technicalDetails: !technicalDetails })
        }
      ]
    },
    { role: 'windowMenu' }
  ];
}

/**
 * The menu-bar icon's menu, pure like buildMenuTemplate. Start shows the
 * window first and then goes through the window's own Start, so a start that
 * is blocked says why where it can be seen. It sends 'start-server', which only
 * ever starts: the window may act on it a moment later (it may be opening),
 * and by then it must not become a Stop. Stop needs nothing from the window and
 * stops the server directly (ruling R20, as in Part A).
 */
export function trayMenuTemplate(opts: {
  serverStatus: ServerStatus;
  /** The port a running server listens on, for the status line. */
  port: number | null;
  hasDashboard: boolean;
  send: (a: MenuAction) => void;
  /** Brings the window up, opening it again if it was closed. */
  show: () => void;
  /** Stops the server. */
  stop: () => void;
  quit: () => void;
}): MenuItemConstructorOptions[] {
  const { serverStatus, port, hasDashboard, send, show, stop, quit } = opts;
  return [
    { label: trayStatusLabel({ status: serverStatus, port }), enabled: false },
    { type: 'separator' },
    startStopItem(serverStatus, () => {
      if (isActive(serverStatus)) {
        stop();
        return;
      }
      show();
      send('start-server');
    }),
    { label: 'Open Dashboard', enabled: hasDashboard, click: () => send('open-dashboard') },
    { type: 'separator' },
    { label: 'Show Xenon Control', click: show },
    { label: 'Quit Xenon Control', click: quit }
  ];
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
