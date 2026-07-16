import type { MenuItemConstructorOptions } from 'electron';
import type { MenuAction, ServerState } from '@shared/types';

/**
 * Pure menu template builder — no Electron runtime needed, so it stays unit
 * testable. `send` pushes the action to the renderer, which owns all the state
 * these items act on.
 */
export function buildMenuTemplate(opts: {
  serverStatus: ServerState['status'];
  hasDashboard: boolean;
  send: (a: MenuAction) => void;
}): MenuItemConstructorOptions[] {
  const { serverStatus, hasDashboard, send } = opts;
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
        { label: 'Logs', accelerator: 'Cmd+4', click: () => send('tab-logs') }
      ]
    },
    { role: 'windowMenu' }
  ];
}
