import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { IPC } from '@shared/ipc';
import { SECRET_DESCRIPTORS } from '@shared/secrets';
import type { MenuAction, Profile, SecretKey, ServerState, SetupProgress } from '@shared/types';
import { SchemaService } from './SchemaService';
import { SecretsStore } from './SecretsStore';
import { ProfileStore } from './ProfileStore';
import { ProcessSupervisor } from './ProcessSupervisor';
import { ToolchainInspector } from './ToolchainInspector';
import { SetupService, type SetupOptions } from './SetupService';
import { buildConfigYaml, buildLaunchPlan } from './LaunchBuilder';
import { buildMenuTemplate } from './menu';
import { invalidateAppiumHome, resolveAppiumHome, resolvedAppiumHomeInfo, warmAppiumHome } from './appiumHome';
import { defaultAppiumHome, launchConfigDir, logsDir } from './paths';

const schemaService = new SchemaService();
const secretsStore = new SecretsStore();
const profileStore = new ProfileStore();
const toolchain = new ToolchainInspector();
const setupService = new SetupService();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Auto-resolution lives in appiumHome.ts: a profile stores '' for "auto" so it
// stays portable, and the host picks the first home that has the plugin.
function resolveConfigYamlPath(profile: Profile): string {
  return path.join(launchConfigDir(), `${profile.id}.yaml`);
}
function resolveSecrets(profile: Profile): Partial<Record<SecretKey, string>> {
  const out: Partial<Record<SecretKey, string>> = {};
  for (const key of profile.secretRefs) {
    const v = secretsStore.reveal(key);
    if (v) out[key] = v;
  }
  return out;
}

const supervisor = new ProcessSupervisor({
  resolveAppiumHome,
  resolveConfigYamlPath,
  resolveSecrets,
  requiredDefaults: () => schemaService.requiredDefaults()
});

function broadcast(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function refreshMenu(state: ServerState): void {
  const template = buildMenuTemplate({
    serverStatus: state.status,
    hasDashboard: state.status === 'running' && !!state.dashboardUrl,
    send: (a: MenuAction) => broadcast(IPC.evtMenuAction, a)
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

supervisor.on('log', (line) => broadcast(IPC.evtLog, line));
supervisor.on('state', (state: ServerState) => {
  broadcast(IPC.evtServerState, state);
  updateTray(state);
  refreshMenu(state);
});
setupService.on('progress', (p: SetupProgress) => broadcast(IPC.evtSetupProgress, p));

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function trayIcon(state: ServerState): Electron.NativeImage {
  // Simple template dot: filled when running, hollow otherwise. Template images
  // adapt to light/dark menu bars automatically.
  const running = state.status === 'running';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="5" fill="${running ? 'black' : 'none'}" stroke="black" stroke-width="1.5"/>
  </svg>`;
  const img = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  img.setTemplateImage(true);
  return img;
}

function updateTray(state: ServerState): void {
  if (!tray) return;
  tray.setImage(trayIcon(state));
  const label =
    state.status === 'running'
      ? `Xenon: running (:${state.port})`
      : state.status === 'starting'
        ? 'Xenon: starting…'
        : state.status === 'crashed'
          ? 'Xenon: crashed'
          : 'Xenon: stopped';
  const menu = Menu.buildFromTemplate([
    { label, enabled: false },
    { type: 'separator' },
    {
      label: 'Open Dashboard',
      enabled: state.status === 'running' && !!state.dashboardUrl,
      click: () => state.dashboardUrl && shell.openExternal(state.dashboardUrl)
    },
    {
      label: 'Stop Server',
      enabled: supervisor.isActive(),
      click: () => supervisor.stop()
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) mainWindow.show();
        else createWindow();
      }
    },
    { label: 'Quit Xenon Control', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

function createTray(): void {
  tray = new Tray(trayIcon(supervisor.getState()));
  tray.setToolTip('Xenon Control');
  updateTray(supervisor.getState());
}

function registerIpc(): void {
  ipcMain.handle(IPC.schemaGet, () => {
    const { schema, meta } = schemaService.load();
    return { schema, meta, secretDescriptors: SECRET_DESCRIPTORS };
  });

  ipcMain.handle(IPC.profilesList, () => profileStore.list());
  ipcMain.handle(IPC.profileSave, (_e, profile: Profile) => profileStore.save(profile));
  ipcMain.handle(IPC.profileDelete, (_e, id: string) => {
    profileStore.delete(id);
    return profileStore.list();
  });
  ipcMain.handle(IPC.profileDuplicate, (_e, id: string) => profileStore.duplicate(id));

  ipcMain.handle(IPC.profileExport, async (_e, id: string) => {
    const json = profileStore.serialize(id);
    if (!json) return false;
    const profile = profileStore.get(id);
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export profile',
      defaultPath: `${(profile?.name || 'profile').replace(/[^a-z0-9-_]+/gi, '_')}.xenon-profile.json`,
      filters: [{ name: 'Xenon profile', extensions: ['json'] }]
    });
    if (canceled || !filePath) return false;
    writeFileSync(filePath, json, 'utf8');
    return true;
  });

  ipcMain.handle(IPC.profileImport, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import profile(s)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Xenon profile', extensions: ['json'] }]
    });
    if (canceled) return { profiles: profileStore.list(), importedIds: [] };
    const importedIds: string[] = [];
    for (const fp of filePaths) {
      try {
        const parsed = JSON.parse(readFileSync(fp, 'utf8'));
        for (const p of profileStore.importFrom(parsed)) importedIds.push(p.id);
      } catch {
        /* skip unreadable/invalid files */
      }
    }
    return { profiles: profileStore.list(), importedIds };
  });

  ipcMain.handle(IPC.exportConfigYaml, async (_e, profile: Profile) => {
    const yamlText = buildConfigYaml(profile, schemaService.requiredDefaults());
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Appium config',
      defaultPath: `${profile.name.replace(/[^a-z0-9-_]+/gi, '_')}.appium.yaml`,
      filters: [{ name: 'Appium config', extensions: ['yaml', 'yml'] }]
    });
    if (canceled || !filePath) return false;
    writeFileSync(filePath, yamlText, 'utf8');
    return true;
  });

  ipcMain.handle(IPC.secretsStatus, (_e, keys: SecretKey[]) => secretsStore.status(keys));
  ipcMain.handle(IPC.secretSet, (_e, key: SecretKey, value: string) => {
    secretsStore.set(key, value);
    return secretsStore.has(key);
  });
  ipcMain.handle(IPC.secretClear, (_e, key: SecretKey) => {
    secretsStore.clear(key);
    return secretsStore.has(key);
  });

  ipcMain.handle(IPC.serverState, () => supervisor.getState());
  ipcMain.handle(IPC.serverStart, async (_e, profile: Profile) => {
    profileStore.save(profile); // persist latest edits before launch
    return supervisor.start(profile);
  });
  ipcMain.handle(IPC.serverStop, () => supervisor.stop());
  ipcMain.handle(IPC.launchPreview, (_e, profile: Profile) => {
    const plan = buildLaunchPlan(profile, {
      appiumHome: resolveAppiumHome(profile),
      configYamlPath: resolveConfigYamlPath(profile),
      secretValues: {}, // preview never reveals values
      requiredDefaults: schemaService.requiredDefaults()
    });
    return plan.spec;
  });
  ipcMain.handle(IPC.openDashboard, (_e, url: string) => shell.openExternal(url));
  ipcMain.handle(IPC.openPath, (_e, kind: 'logs' | 'appiumHome', profile?: Profile) => {
    const target = kind === 'logs' ? logsDir() : resolveAppiumHome(profile ?? ({ server: { appiumHome: '' } } as Profile));
    return shell.openPath(target);
  });

  ipcMain.handle(IPC.toolchainCheck, (_e, profile?: Profile) => toolchain.checkAll(profile));
  ipcMain.handle(IPC.preflight, (_e, profile: Profile) => toolchain.preflight(profile, resolveAppiumHome(profile)));
  ipcMain.handle(IPC.setupInstall, async (_e, opts: Partial<SetupOptions> & { profileAppiumHome?: string }) => {
    const appiumHome = opts.appiumHome || opts.profileAppiumHome || defaultAppiumHome();
    const result = await setupService.install({
      appiumHome,
      pluginSource: opts.pluginSource ?? 'local',
      drivers: opts.drivers ?? ['uiautomator2', 'xcuitest']
    });
    // A freshly installed home may now be the best auto choice.
    invalidateAppiumHome();
    await warmAppiumHome();
    return result;
  });

  ipcMain.handle(IPC.resolvedAppiumHome, (_e, profile: Profile) => resolvedAppiumHomeInfo(profile));
}

/**
 * Check for updates on launch. No-op in dev and when no publish channel is
 * configured; electron-updater reads the update feed from the packaged
 * app-update.yml (populated by electron-builder's `publish` config). Failures
 * are swallowed so a missing/unreachable feed never blocks startup.
 */
async function maybeCheckForUpdates(): Promise<void> {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.on('update-downloaded', () => {
      broadcast(IPC.evtLog, { ts: Date.now(), stream: 'system', text: 'Update downloaded — restart to apply.' });
    });
    await autoUpdater.checkForUpdatesAndNotify();
  } catch {
    /* no update feed configured or offline — ignore */
  }
}

// Single-instance lock so the tray/server stay authoritative.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  app.whenReady().then(async () => {
    // Resolve the automatic APPIUM_HOME before any window can ask for it.
    await warmAppiumHome();
    registerIpc();
    refreshMenu(supervisor.getState());
    createTray();
    createWindow();
    void maybeCheckForUpdates();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Keep running in the menu bar when all windows are closed.
  app.on('window-all-closed', () => {
    // Intentionally do NOT quit on macOS — the tray keeps the server alive.
  });

  app.on('before-quit', () => {
    supervisor.killNow();
  });
}
