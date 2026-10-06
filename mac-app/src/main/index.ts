import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, shell, Tray } from 'electron';
import { createWriteStream, readFileSync, writeFileSync, type WriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { IPC } from '@shared/ipc';
import { tildify } from '@shared/paths';
import { SECRET_DESCRIPTORS } from '@shared/secrets';
import type { LogLine, MenuAction, Profile, SecretKey, ServerState, SetupProgress } from '@shared/types';
import { isGenuineFreeze, startLagMonitor } from './eventLoopLag';
import { isReportableProcessDeath } from './processDeath';
import { SchemaService } from './SchemaService';
import { SecretsStore } from './SecretsStore';
import { ProfileStore } from './ProfileStore';
import { ProcessSupervisor } from './ProcessSupervisor';
import { ToolchainInspector } from './ToolchainInspector';
import { SetupService } from './SetupService';
import { toSetupOptions, type SetupRequest } from './setupRequest';
import { buildConfigYaml, buildLaunchPlan } from './LaunchBuilder';
import { buildMenuTemplate, stopServerEnabled, trayStatusLabel } from './menu';
import { FORCE_QUIT_CAP_MS, QUIT_WAIT_CAP_MS, decideQuit, withCap } from './quitFlow';
import { invalidateAppiumHome, resolveAppiumHome, resolvedAppiumHomeInfo, warmAppiumHome } from './appiumHome';
import { readInstalledPluginVersion } from './installedPluginVersion';
import { launchConfigDir, logsDir } from './paths';

const schemaService = new SchemaService();
const secretsStore = new SecretsStore();
const profileStore = new ProfileStore(secretsStore);
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

// --- Hang diagnostics -------------------------------------------------------
// The app has frozen intermittently with no reproduction. These turn the next
// freeze into a timestamped, attributable record: whether the *main* thread
// stalled (event-loop lag) or a *child* process (GPU/renderer) died or went
// unresponsive — the two distinct causes an Electron "hang" can have. Records
// go to a persistent diagnostics.log (survives renderer death) and, when the
// renderer is alive, into the in-app log console as system lines.
let diagnosticsStream: WriteStream | null = null;

function recordDiagnostic(text: string): void {
  const ts = Date.now();
  const stamped = `${new Date(ts).toISOString()} [diagnostic] ${text}\n`;
  try {
    if (!diagnosticsStream) diagnosticsStream = createWriteStream(path.join(logsDir(), 'diagnostics.log'), { flags: 'a' });
    diagnosticsStream.write(stamped);
  } catch {
    /* logging must never throw */
  }
  // eslint-disable-next-line no-console
  console.error(`[Xenon Control] ${text}`);
  const line: LogLine = { ts, stream: 'system', text: `⚠ ${text}` };
  broadcast(IPC.evtLog, [line]); // evtLog carries a batch (LogLine[])
}

// The last time the process/window came back to life — from system sleep
// (powerMonitor) or App Nap (window focus). A late heartbeat that spans one of
// these is the app resuming, not a freeze. Updated by installHangDiagnostics
// and the window's 'focus' handler (see createWindow).
let lastWakeAt = Date.now();
function markWake(): void {
  lastWakeAt = Date.now();
}

// Set once the app begins tearing down, so the child-process-gone flood that
// teardown produces (renderer + GPU + utility all SIGTERM'd together) isn't
// misread as a GPU crash. before-quit covers Cmd-Q / logout / restart;
// SIGTERM/SIGINT cover a raw `kill` of the process.
let isQuitting = false;
function markQuitting(): void {
  isQuitting = true;
}
process.once('SIGTERM', () => {
  markQuitting();
  app.quit();
});
process.once('SIGINT', () => {
  markQuitting();
  app.quit();
});

function installHangDiagnostics(): void {
  // System sleep / display sleep / screen lock all suspend the process.
  powerMonitor.on('resume', markWake);
  powerMonitor.on('unlock-screen', markWake);

  // 1. Main-thread stalls: a 1s heartbeat that reports whenever it fires ≥3s
  //    late. A late tick is only a real freeze if the window was focused and the
  //    lateness didn't come from the app resuming from nap/sleep — otherwise
  //    macOS App Nap and system sleep flood this with multi-minute false
  //    "freezes" (see isGenuineFreeze).
  startLagMonitor({
    intervalMs: 1000,
    thresholdMs: 3000,
    now: () => performance.now(),
    onStall: (lagMs) => {
      const focused = mainWindow?.isFocused() ?? false;
      if (!isGenuineFreeze({ lagMs, focused, msSinceWake: Date.now() - lastWakeAt })) return;
      recordDiagnostic(`Main thread stalled ~${lagMs}ms while the window was focused — genuine UI freeze.`);
    }
  });

  // 2. A child process (GPU / renderer / utility) dying — but only while the app
  //    is running. During teardown the parent SIGTERMs its whole child tree, so
  //    every death there is shutdown noise, not a GPU stall (see
  //    isReportableProcessDeath / isQuitting).
  app.on('child-process-gone', (_e, details) => {
    if (!isReportableProcessDeath(details.reason, isQuitting)) return;
    recordDiagnostic(
      `Child process gone: type=${details.type}${details.serviceName ? ` (${details.serviceName})` : ''} ` +
        `reason=${details.reason} exitCode=${details.exitCode}`
    );
  });
  app.on('render-process-gone', (_e, _wc, details) => {
    if (!isReportableProcessDeath(details.reason, isQuitting)) return;
    recordDiagnostic(`Renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });
}
// ---------------------------------------------------------------------------

function refreshMenu(state: ServerState): void {
  const template = buildMenuTemplate({
    serverStatus: state.status,
    hasDashboard: state.status === 'running' && !!state.dashboardUrl,
    send: (a: MenuAction) => broadcast(IPC.evtMenuAction, a)
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

supervisor.on('log', (batch: LogLine[]) => broadcast(IPC.evtLog, batch));
supervisor.on('state', (state: ServerState) => {
  broadcast(IPC.evtServerState, state);
  updateTray(state);
  refreshMenu(state);
});
setupService.on('progress', (p: SetupProgress) => broadcast(IPC.evtSetupProgress, p));

/**
 * A packaged app takes its dock icon from the bundle, but `electron-vite dev`
 * runs the stock Electron binary — which shows Electron's own icon unless we
 * set it. Without this, the icon only appears after packaging.
 */
function applyDockIcon(): void {
  if (app.isPackaged || !app.dock) return;
  const icon = path.join(__dirname, '../../build/icon.png');
  const img = nativeImage.createFromPath(icon);
  if (!img.isEmpty()) app.dock.setIcon(img);
}

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

  // Regaining focus ends App Nap; a heartbeat that was late because the app was
  // napped fires right after this. Mark it a wake so it isn't miscounted as a
  // freeze (see isGenuineFreeze / lastWakeAt).
  mainWindow.on('focus', markWake);

  // The renderer stops pumping its event loop (heavy paint, stuck JS). Electron
  // fires these on the window's webContents — record the freeze and recovery.
  mainWindow.webContents.on('unresponsive', () =>
    recordDiagnostic('Renderer became unresponsive (UI frozen).')
  );
  mainWindow.webContents.on('responsive', () => recordDiagnostic('Renderer responsive again.'));

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
  const label = trayStatusLabel(state);
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
      enabled: stopServerEnabled(state.status),
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
  ipcMain.handle(IPC.installedPluginVersion, (_e, profile: Profile) =>
    readInstalledPluginVersion(resolveAppiumHome(profile)),
  );

  ipcMain.handle(IPC.toolchainCheck, (_e, profile?: Profile) => toolchain.checkAll(profile));
  ipcMain.handle(IPC.preflight, (_e, profile: Profile) => toolchain.preflight(profile, resolveAppiumHome(profile)));
  ipcMain.handle(IPC.setupInstall, async (_e, req: SetupRequest) => {
    // Same resolver as the header, preflight, version probe and launch.
    const result = await setupService.install(toSetupOptions(req, resolveAppiumHome));
    // A freshly installed home may now be the best auto choice.
    invalidateAppiumHome();
    await warmAppiumHome();
    return result;
  });

  ipcMain.handle(IPC.resolvedAppiumHome, (_e, profile: Profile) => {
    const info = resolvedAppiumHomeInfo(profile);
    return { ...info, display: tildify(info.path, os.homedir()) };
  });
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
      broadcast(IPC.evtLog, [{ ts: Date.now(), stream: 'system', text: 'Update downloaded — restart to apply.' }]);
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
    installHangDiagnostics();
    applyDockIcon();
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

  // Quit waits for Xenon's own shutdown drain (recordings, device release,
  // go-ios/iproxy reaping). A second ⌘Q while waiting forces the stop.
  let quitPending = false;
  let readyToQuit = false;
  let forceCapTimer: ReturnType<typeof setTimeout> | null = null;
  const finishQuit = (): void => {
    if (readyToQuit) return;
    readyToQuit = true;
    if (forceCapTimer) clearTimeout(forceCapTimer);
    app.quit();
  };
  app.on('before-quit', (event) => {
    if (readyToQuit) return;
    markQuitting(); // suppress the teardown child-process-gone flood
    const decision = decideQuit({
      serverActive: supervisor.isActive(),
      stopping: supervisor.getState().status === 'stopping',
      quitPending
    });
    if (decision === 'quit') return;

    event.preventDefault();
    // Keep the window up (reopen it if it was closed to the tray) so the
    // stopping state is visible for the whole wait.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
    const firstDeferral = !quitPending;
    quitPending = true;
    if (decision === 'stop-then-quit') void supervisor.stop();
    else if (decision === 'force-then-quit') {
      supervisor.forceStop();
      // The first quit's longer cap no longer applies: once forced, quit within
      // the force window even if the child never reports an exit.
      if (!forceCapTimer) forceCapTimer = setTimeout(finishQuit, FORCE_QUIT_CAP_MS);
    }
    // 'wait': a Stop is already under way; nothing new to start.

    // One waiter is enough; a repeat ⌘Q only escalates the stop above.
    if (!firstDeferral) return;
    void withCap(supervisor.whenStopped(), QUIT_WAIT_CAP_MS).then(finishQuit);
  });
}
