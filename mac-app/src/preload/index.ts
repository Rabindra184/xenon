import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipc';
import type { LinkName } from '@shared/links';
import type { Preferences } from '@shared/preferences';
import type {
  EffectiveSchemaInfo,
  LastRun,
  LaunchSpec,
  LogLine,
  MenuAction,
  PreflightResult,
  Profile,
  ProfileExportResult,
  SchemaMeta,
  SecretDescriptor,
  SecretKey,
  SecretSaveResult,
  SecretsStatus,
  ServerState,
  SetupProgress,
  SetupResult,
  ShareAddresses,
  XenonSchema
} from '@shared/types';

// Whitelisted, typed API exposed to the renderer. The renderer has no direct
// access to Node, Electron, the filesystem, or raw secret values.
const api = {
  /** The option list for the profile's Appium folder; `{ bundled: true }` asks for the snapshot bundled with the app. */
  getSchema: (
    p?: Profile | null,
    opts?: { bundled?: boolean }
  ): Promise<{
    schema: XenonSchema;
    meta: SchemaMeta;
    secretDescriptors: SecretDescriptor[];
    info: EffectiveSchemaInfo;
  }> => ipcRenderer.invoke(IPC.schemaGet, p, opts),

  profiles: {
    list: (): Promise<Profile[]> => ipcRenderer.invoke(IPC.profilesList),
    save: (p: Profile): Promise<Profile> => ipcRenderer.invoke(IPC.profileSave, p),
    delete: (id: string): Promise<Profile[]> => ipcRenderer.invoke(IPC.profileDelete, id),
    duplicate: (id: string): Promise<Profile | null> => ipcRenderer.invoke(IPC.profileDuplicate, id),
    export: (id: string): Promise<ProfileExportResult> => ipcRenderer.invoke(IPC.profileExport, id),
    import: (): Promise<{ profiles: Profile[]; importedIds: string[]; files: string[]; unreadable: string[] }> =>
      ipcRenderer.invoke(IPC.profileImport),
    exportConfigYaml: (p: Profile): Promise<boolean> => ipcRenderer.invoke(IPC.exportConfigYaml, p),
    /** The profile the window had open last on this Mac, or null. */
    lastOpen: (): Promise<string | null> => ipcRenderer.invoke(IPC.profileOpenGet),
    /** Remembers the profile the window has open (null: none), for a reopened window and the next launch. */
    setOpen: (id: string | null): Promise<void> => ipcRenderer.invoke(IPC.profileOpenSet, id)
  },

  /**
   * The Keychain secrets: never a value back. An app-wide secret is one for the
   * whole app; a profile's own (the cloud key, the proxy password) is the one of
   * the profile `profileId` names.
   */
  secrets: {
    status: (keys: SecretKey[], profileId: string | null): Promise<SecretsStatus> =>
      ipcRenderer.invoke(IPC.secretsStatus, keys, profileId),
    set: (key: SecretKey, value: string, profileId: string | null): Promise<SecretSaveResult> =>
      ipcRenderer.invoke(IPC.secretSet, key, value, profileId),
    /** True when the secret is cleared. */
    clear: (key: SecretKey, profileId: string | null): Promise<boolean> => ipcRenderer.invoke(IPC.secretClear, key, profileId)
  },

  server: {
    state: (): Promise<ServerState> => ipcRenderer.invoke(IPC.serverState),
    /** The log lines main keeps now, oldest first, each with its id: what a window starts from when it opens. */
    logs: (): Promise<LogLine[]> => ipcRenderer.invoke(IPC.serverLogs),
    /** Logs' Clear: main forgets its lines too, through the newest one the window had (by id). */
    clearLogs: (throughId: number): Promise<void> => ipcRenderer.invoke(IPC.serverClearLogs, throughId),
    start: (p: Profile): Promise<ServerState> => ipcRenderer.invoke(IPC.serverStart, p),
    stop: (): Promise<void> => ipcRenderer.invoke(IPC.serverStop),
    launchPreview: (p: Profile): Promise<LaunchSpec> => ipcRenderer.invoke(IPC.launchPreview, p),
    /** Opens the running server's dashboard, the address main knows; false when none runs. */
    openDashboard: (): Promise<boolean> => ipcRenderer.invoke(IPC.openDashboard),
    /** '' when the folder opened; else a plain sentence (it isn't there, or isn't a folder). */
    openPath: (kind: 'logs' | 'appiumHome', p?: Profile): Promise<string> =>
      ipcRenderer.invoke(IPC.openPath, kind, p),
    resolvedAppiumHome: (p: Profile): Promise<{ path: string; source: string; display: string }> =>
      ipcRenderer.invoke(IPC.resolvedAppiumHome, p),
    installedPluginVersion: (p: Profile): Promise<string | null> =>
      ipcRenderer.invoke(IPC.installedPluginVersion, p),
    /** How the profile's server last ended, or null when it has not run. Already kept when the state that ended it arrives. */
    lastRun: (profileId: string): Promise<LastRun | null> => ipcRenderer.invoke(IPC.lastRun, profileId)
  },

  share: {
    /** The address for tests on this Mac and the one for colleagues on the network, for the profile's port and base path. */
    addresses: (profile: { server: Pick<Profile['server'], 'port' | 'basePath'> }): Promise<ShareAddresses> =>
      ipcRenderer.invoke(IPC.shareAddresses, { port: profile.server.port, basePath: profile.server.basePath }),
    /** Puts the text on the clipboard. */
    copy: (text: string): Promise<void> => ipcRenderer.invoke(IPC.shareCopy, text)
  },

  logs: {
    /** Asks where to save the text and writes it there. True when saved, false when the person cancels; rejects when the file can't be written. */
    saveAs: (text: string): Promise<boolean> => ipcRenderer.invoke(IPC.logsSaveAs, text)
  },

  net: {
    /** The first port from `from` upwards that nothing listens on; null when none of the next 50 is free. */
    nextFreePort: (from: number): Promise<number | null> => ipcRenderer.invoke(IPC.nextFreePort, from)
  },

  app: {
    /** Opens one of the app's known web pages in the browser. False when the name is not one of them or it did not open. */
    openLink: (name: LinkName): Promise<boolean> => ipcRenderer.invoke(IPC.openLink, name)
  },

  prefs: {
    get: (): Promise<Preferences> => ipcRenderer.invoke(IPC.prefsGet),
    set: (patch: Partial<Preferences>): Promise<Preferences> => ipcRenderer.invoke(IPC.prefsSet, patch)
  },

  toolchain: {
    /** `fresh`: a look the person asked for, which reads the login shell again too (R80). */
    preflight: (p: Profile, look?: { fresh: boolean }): Promise<PreflightResult> =>
      ipcRenderer.invoke(IPC.preflight, p, look)
  },

  setup: {
    install: (req: {
      profile: Profile;
      pluginSource?: 'local' | 'npm';
      drivers?: Array<'uiautomator2' | 'xcuitest'>;
    }): Promise<SetupResult> => ipcRenderer.invoke(IPC.setupInstall, req)
  },

  // Event subscriptions. Each returns an unsubscribe function.
  // Log lines arrive coalesced as a batch (see ProcessSupervisor's LogBatcher).
  onLog: (cb: (lines: LogLine[]) => void) => subscribe(IPC.evtLog, cb),
  onServerState: (cb: (state: ServerState) => void) => subscribe(IPC.evtServerState, cb),
  onSetupProgress: (cb: (p: SetupProgress) => void) => subscribe(IPC.evtSetupProgress, cb),
  onMenuAction: (cb: (a: MenuAction) => void) => subscribeMenuActions(cb),
  onPrefs: (cb: (p: Preferences) => void) => subscribe(IPC.evtPrefs, cb)
};

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Menu actions are listened for from the start and held until the page
// listens. A window opened from the menu-bar icon's Start Server gets that
// Start as soon as it has loaded, before the page has read its profiles and is
// ready to act on it; the page subscribes once it is.
const menuListeners = new Set<(a: MenuAction) => void>();
const heldMenuActions: MenuAction[] = [];

function deliverMenuAction(action: MenuAction): void {
  if (menuListeners.size === 0) heldMenuActions.push(action);
  else for (const listener of menuListeners) listener(action);
}

ipcRenderer.on(IPC.evtMenuAction, (_e, action: MenuAction) => deliverMenuAction(action));

function subscribeMenuActions(cb: (a: MenuAction) => void): () => void {
  menuListeners.add(cb);
  if (heldMenuActions.length > 0) {
    const held = heldMenuActions.splice(0);
    // After the subscribing effect has returned, to whoever listens then (or held again if nobody does).
    queueMicrotask(() => held.forEach(deliverMenuAction));
  }
  return () => {
    menuListeners.delete(cb);
  };
}

contextBridge.exposeInMainWorld('xenon', api);

export type XenonApi = typeof api;
