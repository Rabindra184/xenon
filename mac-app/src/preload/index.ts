import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipc';
import type { Preferences } from '@shared/preferences';
import type {
  EffectiveSchemaInfo,
  LaunchSpec,
  LogLine,
  MenuAction,
  PreflightResult,
  Profile,
  ProfileExportResult,
  SchemaMeta,
  SecretDescriptor,
  SecretKey,
  ServerState,
  SetupProgress,
  SetupResult,
  ToolCheck,
  XenonSchema
} from '@shared/types';

// Whitelisted, typed API exposed to the renderer. The renderer has no direct
// access to Node, Electron, the filesystem, or raw secret values.
const api = {
  getSchema: (
    p?: Profile
  ): Promise<{
    schema: XenonSchema;
    meta: SchemaMeta;
    secretDescriptors: SecretDescriptor[];
    info: EffectiveSchemaInfo;
  }> => ipcRenderer.invoke(IPC.schemaGet, p),

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

  secrets: {
    status: (keys: SecretKey[]): Promise<Record<string, boolean>> => ipcRenderer.invoke(IPC.secretsStatus, keys),
    set: (key: SecretKey, value: string): Promise<boolean> => ipcRenderer.invoke(IPC.secretSet, key, value),
    clear: (key: SecretKey): Promise<boolean> => ipcRenderer.invoke(IPC.secretClear, key)
  },

  server: {
    state: (): Promise<ServerState> => ipcRenderer.invoke(IPC.serverState),
    start: (p: Profile): Promise<ServerState> => ipcRenderer.invoke(IPC.serverStart, p),
    stop: (): Promise<void> => ipcRenderer.invoke(IPC.serverStop),
    launchPreview: (p: Profile): Promise<LaunchSpec> => ipcRenderer.invoke(IPC.launchPreview, p),
    openDashboard: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openDashboard, url),
    openPath: (kind: 'logs' | 'appiumHome', p?: Profile): Promise<string> =>
      ipcRenderer.invoke(IPC.openPath, kind, p),
    resolvedAppiumHome: (p: Profile): Promise<{ path: string; source: string; display: string }> =>
      ipcRenderer.invoke(IPC.resolvedAppiumHome, p),
    installedPluginVersion: (p: Profile): Promise<string | null> =>
      ipcRenderer.invoke(IPC.installedPluginVersion, p)
  },

  prefs: {
    get: (): Promise<Preferences> => ipcRenderer.invoke(IPC.prefsGet),
    set: (patch: Partial<Preferences>): Promise<Preferences> => ipcRenderer.invoke(IPC.prefsSet, patch)
  },

  toolchain: {
    check: (p?: Profile): Promise<ToolCheck[]> => ipcRenderer.invoke(IPC.toolchainCheck, p),
    preflight: (p: Profile): Promise<PreflightResult> => ipcRenderer.invoke(IPC.preflight, p)
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
