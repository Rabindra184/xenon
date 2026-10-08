import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, powerMonitor, shell, Tray } from 'electron';
import { createWriteStream, readFileSync, writeFileSync, type WriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { IPC } from '@shared/ipc';
import { linkUrl } from '@shared/links';
import { tildify } from '@shared/paths';
import type { Preferences } from '@shared/preferences';
import { SECRET_DESCRIPTORS } from '@shared/secrets';
import { WINDOW_BACKGROUND } from '@shared/windowBackground';
import type {
  EffectiveSchemaInfo,
  LogLine,
  MenuAction,
  Profile,
  ProfileExportResult,
  SecretKey,
  ServerState,
  SetupProgress,
  XenonSchema
} from '@shared/types';
import { isGenuineFreeze, startLagMonitor } from './eventLoopLag';
import { isReportableProcessDeath } from './processDeath';
import { SchemaService } from './SchemaService';
import { SecretsStore } from './SecretsStore';
import { launchSecrets } from './profileSecrets';
import { clearSecret, saveSecret, secretsStatus } from './secretsApi';
import { ProfileStore } from './ProfileStore';
import { PreferencesStore } from './PreferencesStore';
import { ProcessSupervisor } from './ProcessSupervisor';
import { ToolchainInspector } from './ToolchainInspector';
import { SetupService } from './SetupService';
import { toSetupOptions, type SetupRequest } from './setupRequest';
import { buildConfigYaml } from './LaunchBuilder';
import { clearLaunchConfigs, launchConfigPath, removeLaunchConfig } from './launchConfigs';
import { requiredDefaults } from './configDefaults';
import { buildMenuTemplate, trayCopyTestAddress, trayMenuTemplate } from './menu';
import { fileStem, logFileName } from './fileNames';
import { LastRunStore } from './LastRunStore';
import { forgetLastRun, lastRunRecorder } from './lastRun';
import { nextFreePort } from './nextFreePort';
import { oneAtATime } from './oneAtATime';
import { MAIN_COPY } from './copy';
import { shareAddresses } from './shareAddresses';
import { macLocalName } from './macName';
import { FORCE_QUIT_CAP_MS, QUIT_WAIT_CAP_MS, decideQuit, withCap } from './quitFlow';
import { invalidateAppiumHome, resolveAppiumHome, resolvedAppiumHomeInfo, warmAppiumHome } from './appiumHome';
import { beginLook } from './env';
import { openRequests } from './openRequests';
import { readInstalledPluginVersion } from './installedPluginVersion';
import { defaultAppiumHome, launchConfigDir, logsDir } from './paths';

const schemaService = new SchemaService();
const secretsStore = new SecretsStore();
const profileStore = new ProfileStore(secretsStore);
const prefsStore = new PreferencesStore();
const lastRuns = new LastRunStore();
const toolchain = new ToolchainInspector();
const setupService = new SetupService();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Auto-resolution lives in appiumHome.ts: a profile stores '' for "auto" so it
// stays portable, and the host picks the first home that has the plugin.
// Only ever a file directly in the launch-configs folder, whatever the id the window sent (row 41).
function resolveConfigYamlPath(profile: Profile): string {
  return launchConfigPath(launchConfigDir(), profile.id);
}
// The app-wide secrets the profile turns on, and its own cloud key and proxy password (R54).
function resolveSecrets(profile: Profile): Partial<Record<SecretKey, string>> {
  return launchSecrets(profile, secretsStore);
}

// The window's secrets:* calls act on an app-wide slot, or on a saved profile's own (secretsApi).
const secretsDeps = { vault: secretsStore, profileExists: (id: string) => profileStore.get(id) !== null };

// What the window asks to open, checked here (M8): main's own dashboard, and only a folder that is one.
const opens = openRequests({
  openExternal: (url) => shell.openExternal(url),
  openPath: (target) => shell.openPath(target),
  serverState: () => supervisor.getState(),
  logsDir,
  appiumHome: (profile) => resolveAppiumHome(profile ?? ({ server: { appiumHome: '' } } as Profile))
});

const supervisor = new ProcessSupervisor({
  resolveAppiumHome,
  resolveConfigYamlPath,
  resolveSecrets,
  schemaFor: (profile) => schemaService.effectiveSchema(resolveAppiumHome(profile)).schema
});

function broadcast(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

// --- Hang diagnostics -------------------------------------------------------
// The app has frozen intermittently with no reproduction. These turn the next
// freeze into a timestamped, attributable record: whether the *main* thread
// stalled (event-loop lag) or a *child* process (GPU/renderer) died or went
// unresponsive — the two distinct causes an Electron "hang" can have. Records
// go to a persistent diagnostics.log (survives renderer death) and into the
// in-app log console as system lines, kept with the run's lines (a window opened
// later shows them too).
let diagnosticsStream: WriteStream | null = null;

/** Says a launch config could not be deleted (launchConfigs.ts). */
function launchConfigNotDeleted(err: unknown): void {
  recordDiagnostic(`${MAIN_COPY.launchConfigNotDeleted} ${String(err)}`);
}

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
  // Kept by the supervisor, which gives it its id and sends it on (technical details only).
  supervisor.note(`⚠ ${text}`);
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

/**
 * Gives a menu action to the window, which owns the state it acts on. The
 * window is brought up first, and opened again if it was closed, so an item
 * chosen with no window (⌘1, ⌘N, Manage Profiles…, ⌘⏎) is still done. A
 * window still loading (just opened, or reloading) gets it once loaded; the
 * preload holds it until the page listens.
 */
function sendMenuAction(action: MenuAction): void {
  showWindow();
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.evtMenuAction, action);
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

/** What a menu item (the app menu or the menu-bar icon's) does. The dashboard opens in the browser, with no window needed. */
function dispatchMenuAction(action: MenuAction): void {
  if (action === 'open-dashboard') {
    void opens.openDashboard();
    return;
  }
  sendMenuAction(action);
}

/** Brings the window up: restored, shown and focused, or opened again if it was closed. */
function showWindow(): void {
  // A window closed a moment ago may not have reported 'closed' yet.
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  // Just opened and not yet drawn: it shows itself once it is (ready-to-show), in its own colours.
  if (!mainWindow.isVisible() && mainWindow.webContents.isLoading()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const hasDashboard = (state: ServerState): boolean => state.status === 'running' && !!state.dashboardUrl;

function refreshMenu(state: ServerState): void {
  const prefs = prefsStore.get();
  const template = buildMenuTemplate({
    serverStatus: state.status,
    hasDashboard: hasDashboard(state),
    technicalDetails: prefs.technicalDetails,
    appearance: prefs.appearance,
    send: dispatchMenuAction,
    setPrefs: setPreferences
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** The window's own colour, the page's --bg in the theme the window is in (WINDOW_BACKGROUND is generated from the tokens). */
const windowBackground = (): string => WINDOW_BACKGROUND[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];

// nativeTheme.themeSource decides the window's prefers-color-scheme, which the
// renderer follows (see renderer theme.ts). 'system' is the Mac's own setting.
function applyAppearance(prefs: Preferences): void {
  nativeTheme.themeSource = prefs.appearance;
}

// The one path for a preferences change, whether it comes from the window or
// the View menu (Appearance, Show Technical Details): save it, apply it, tell
// the window, and redraw the menu so it shows the new choice.
function setPreferences(patch: Partial<Preferences>): Preferences {
  const prefs = prefsStore.set(patch);
  applyAppearance(prefs);
  broadcast(IPC.evtPrefs, prefs);
  refreshMenu(supervisor.getState());
  return prefs;
}

supervisor.on('log', (batch: LogLine[]) => broadcast(IPC.evtLog, batch));
// A run that ended is kept before the state that ended it is announced, so the
// window, asking how the last run ended on that announcement, always finds it.
const recordLastRun = lastRunRecorder({
  initial: supervisor.getState(),
  keep: (profileId, run) => lastRuns.set(profileId, run),
  // Not being able to keep this must never stop the state reaching the window and the menu-bar icon.
  // eslint-disable-next-line no-console
  onError: (err) => console.error('[Xenon Control] could not keep how the last run ended:', err)
});

supervisor.on('state', (state: ServerState) => {
  recordLastRun(state);
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
    // Painted before the page loads and at the edges while resizing; it follows the theme (see whenReady).
    backgroundColor: windowBackground(),
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
  const template = trayMenuTemplate({
    serverStatus: state.status,
    port: state.port,
    hasDashboard: hasDashboard(state),
    send: dispatchMenuAction,
    show: showWindow,
    stop: () => void supervisor.stop(),
    copyTestAddress: copyTestAddressFromTray,
    quit: () => app.quit()
  });
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

/**
 * The menu-bar icon's Copy Test Address. While a server is active main copies
 * its address itself and the window stays where it is (hidden, or behind
 * another app); otherwise the window copies the open profile's, as ⇧⌘C does.
 */
function copyTestAddressFromTray(): void {
  const copy = trayCopyTestAddress(supervisor.getState());
  if (copy.kind === 'copy') clipboard.writeText(copy.address);
  else sendMenuAction('copy-test-address');
}

function createTray(): void {
  tray = new Tray(trayIcon(supervisor.getState()));
  tray.setToolTip('Xenon Control');
  updateTray(supervisor.getState());
}

function registerIpc(): void {
  ipcMain.handle(IPC.prefsGet, () => prefsStore.get());
  ipcMain.handle(IPC.prefsSet, (_e, patch: Partial<Preferences>) => setPreferences(patch));

  // The option list for the profile's Appium folder (the installed Xenon's own
  // when readable); `meta` always describes the bundled snapshot. `bundled`
  // asks for the snapshot itself, which is also the answer when the folder
  // can't be worked out, so the window always has a list to check settings by.
  ipcMain.handle(IPC.schemaGet, (_e, profile?: Profile | null, opts?: { bundled?: boolean }) => {
    const { schema: bundled, meta } = schemaService.load();
    let effective: { schema: XenonSchema; info: EffectiveSchemaInfo } = {
      schema: bundled,
      info: { source: 'bundled', pluginVersion: meta.pluginVersion, installedVersion: null }
    };
    if (!opts?.bundled) {
      try {
        effective = schemaService.effectiveSchema(profile ? resolveAppiumHome(profile) : defaultAppiumHome());
      } catch (err) {
        recordDiagnostic(`Could not read the option list for a profile's Appium folder; using the bundled one. ${String(err)}`);
      }
    }
    return { schema: effective.schema, meta, secretDescriptors: SECRET_DESCRIPTORS, info: effective.info };
  });

  ipcMain.handle(IPC.profilesList, () => profileStore.list());
  ipcMain.handle(IPC.profileSave, (_e, profile: Profile) => profileStore.save(profile));
  ipcMain.handle(IPC.profileDelete, (_e, id: string) => {
    profileStore.delete(id);
    // Its last launch's config goes with it; one an older version wrote can hold a secret.
    removeLaunchConfig(launchConfigDir(), String(id), launchConfigNotDeleted);
    // The profile is gone: a last run that can't be forgotten is noted, and the delete still answers.
    forgetLastRun(
      (profileId) => lastRuns.forget(profileId),
      id,
      (err) => recordDiagnostic(`Could not forget how a deleted profile's last run ended. ${String(err)}`)
    );
    return profileStore.list();
  });
  ipcMain.handle(IPC.profileDuplicate, (_e, id: string) => profileStore.duplicate(id));
  ipcMain.handle(IPC.profileOpenGet, () => profileStore.openId());
  ipcMain.handle(IPC.profileOpenSet, (_e, id: unknown) => profileStore.setOpenId(typeof id === 'string' ? id : null));

  ipcMain.handle(IPC.profileExport, async (_e, id: string): Promise<ProfileExportResult> => {
    const exported = profileStore.exportData(id);
    if (!exported) return { saved: false, leftOut: [] };
    const profile = profileStore.get(id);
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export profile',
      defaultPath: `${fileStem(profile?.name, 'profile')}.xenon-profile.json`,
      filters: [{ name: 'Xenon profile', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { saved: false, leftOut: [] };
    writeFileSync(filePath, exported.json, 'utf8');
    return { saved: true, leftOut: exported.leftOut };
  });

  ipcMain.handle(IPC.profileImport, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import profile(s)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Xenon profile', extensions: ['json'] }]
    });
    if (canceled) return { profiles: profileStore.list(), importedIds: [], files: [], unreadable: [] };
    const importedIds: string[] = [];
    const files: string[] = [];
    const unreadable: string[] = [];
    for (const fp of filePaths) {
      const name = path.basename(fp);
      try {
        const parsed = JSON.parse(readFileSync(fp, 'utf8'));
        for (const p of profileStore.importFrom(parsed)) importedIds.push(p.id);
        files.push(name);
      } catch {
        unreadable.push(name); // reported back, not dropped
      }
    }
    return { profiles: profileStore.list(), importedIds, files, unreadable };
  });

  ipcMain.handle(IPC.exportConfigYaml, async (_e, profile: Profile) => {
    const schema = schemaService.effectiveSchema(resolveAppiumHome(profile)).schema;
    const yamlText = buildConfigYaml(profile, requiredDefaults(schema), schema);
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Appium config',
      defaultPath: `${fileStem(profile.name, 'profile')}.appium.yaml`,
      filters: [{ name: 'Appium config', extensions: ['yaml', 'yml'] }]
    });
    if (canceled || !filePath) return false;
    writeFileSync(filePath, yamlText, 'utf8');
    return true;
  });

  // A profile's own secret (the cloud key, the proxy password) is the one of the profile the window names.
  ipcMain.handle(IPC.secretsStatus, (_e, keys: unknown, profileId: unknown) => secretsStatus(secretsDeps, keys, profileId));
  ipcMain.handle(IPC.secretSet, (_e, key: unknown, value: unknown, profileId: unknown) =>
    saveSecret(secretsDeps, key, value, profileId)
  );
  ipcMain.handle(IPC.secretClear, (_e, key: unknown, profileId: unknown) => clearSecret(secretsDeps, key, profileId));

  ipcMain.handle(IPC.serverState, () => supervisor.getState());
  // The lines main kept, which a window starts from when it opens (R67), and Logs' Clear, which
  // clears them here too, through the newest line the window had.
  ipcMain.handle(IPC.serverLogs, () => supervisor.getLogs());
  ipcMain.handle(IPC.serverClearLogs, (_e, throughId: unknown) => {
    if (typeof throughId !== 'number' || Number.isNaN(throughId)) throw new TypeError('Clear needs the id of a line.');
    supervisor.clearLogs(throughId);
  });
  ipcMain.handle(IPC.serverStart, async (_e, profile: Profile) => {
    // Persist the latest edits, and launch the profile as stored: a draft can still hold a
    // secret value the save moved into the Keychain, and not yet inject it. Its values are
    // final now, so an env var's secret moves too (saveToStart).
    return supervisor.start(profileStore.saveToStart(profile));
  });
  ipcMain.handle(IPC.serverStop, () => supervisor.stop());
  // The launch a start would make, Keychain secrets and all, as names only (ProcessSupervisor.preview).
  ipcMain.handle(IPC.launchPreview, (_e, profile: Profile) => supervisor.preview(profile));
  // The window's word is not taken for what to open (M8): see openRequests.
  ipcMain.handle(IPC.openDashboard, () => opens.openDashboard());
  ipcMain.handle(IPC.openPath, (_e, kind: unknown, profile?: unknown) => opens.openPath(kind, profile));
  ipcMain.handle(IPC.installedPluginVersion, (_e, profile: Profile) =>
    readInstalledPluginVersion(resolveAppiumHome(profile)),
  );
  ipcMain.handle(IPC.lastRun, (_e, profileId: unknown) =>
    typeof profileId === 'string' ? lastRuns.get(profileId) : null
  );

  // The addresses are worked out here because only main knows the Mac's name: its Bonjour name (R27).
  ipcMain.handle(IPC.shareAddresses, async (_e, server: { port?: unknown; basePath?: unknown }) => {
    const { port, basePath } = server ?? {};
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new TypeError('The addresses need a port from 1 to 65535.');
    }
    return shareAddresses({ port, basePath: typeof basePath === 'string' ? basePath : '' }, await macLocalName());
  });
  ipcMain.handle(IPC.shareCopy, (_e, text: unknown) => {
    if (typeof text !== 'string') throw new TypeError('Only text can be copied.');
    clipboard.writeText(text);
  });
  // Save as… in Logs: the text on screen, to a file the person picks. False when they cancel; a file
  // that can't be written rejects, so the window can say so instead of looking like a cancel.
  ipcMain.handle(IPC.logsSaveAs, async (_e, text: unknown): Promise<boolean> => {
    if (typeof text !== 'string') throw new TypeError('Only text can be saved.');
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: MAIN_COPY.saveLogsTitle,
      defaultPath: logFileName(new Date()),
      filters: [{ name: MAIN_COPY.textFileFilter, extensions: ['txt'] }]
    });
    if (canceled || !filePath) return false;
    writeFileSync(filePath, text, 'utf8');
    return true;
  });
  ipcMain.handle(IPC.nextFreePort, (_e, from: unknown) =>
    typeof from === 'number' ? nextFreePort(from) : null
  );
  // The window sends a name from LINKS, never an address; anything else opens nothing.
  ipcMain.handle(IPC.openLink, async (_e, name: unknown): Promise<boolean> => {
    const url = linkUrl(name);
    if (!url) return false;
    try {
      await shell.openExternal(url);
      return true;
    } catch {
      return false;
    }
  });

  // While our own server runs it holds its port, so the port check is skipped rather than blame another app.
  // A look the person asked for (Check again, Try again, Start's own look) reads the login shell again;
  // any other keeps a good read and tries again only one that failed (R80).
  ipcMain.handle(IPC.preflight, (_e, profile: Profile, look?: unknown) => {
    beginLook({ fresh: (look as { fresh?: unknown } | null | undefined)?.fresh === true });
    return toolchain.preflight(profile, resolveAppiumHome(profile), { skipPortCheck: supervisor.isActive() });
  });
  // One run at a time: two would write the same Appium folder. The window never asks twice, but a
  // window opened again while a run goes on does not know about it.
  const runSetup = oneAtATime(
    async (req: SetupRequest) => {
      // Same resolver as the Appium folder field, preflight, version probe and launch.
      const result = await setupService.install(toSetupOptions(req, resolveAppiumHome));
      // A freshly installed home may now be the best auto choice.
      invalidateAppiumHome();
      await warmAppiumHome();
      return result;
    },
    () => new Error(MAIN_COPY.setupAlreadyRunning)
  );
  ipcMain.handle(IPC.setupInstall, (_e, req: SetupRequest) => runSetup(req));

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
      // For the tester, not only for technical details (R58).
      supervisor.note('Update downloaded — restart to apply.', { always: true });
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
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    // Resolve the automatic APPIUM_HOME before any window can ask for it.
    await warmAppiumHome();
    installHangDiagnostics();
    applyDockIcon();
    // Before the window exists, so its first frame is already in the chosen theme.
    applyAppearance(prefsStore.get());
    // The window's own colour follows the theme: the Mac's, or the one chosen in View > Appearance.
    nativeTheme.on('updated', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(windowBackground());
    });
    // Before any launch: configs an older version wrote can hold a secret, and each launch writes its own.
    clearLaunchConfigs(launchConfigDir(), launchConfigNotDeleted);
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
    showWindow();
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
