import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipc';
import type {
  LaunchSpec,
  LogLine,
  MenuAction,
  PreflightResult,
  Profile,
  SchemaMeta,
  SecretDescriptor,
  SecretKey,
  ServerState,
  SetupProgress,
  ToolCheck,
  XenonSchema
} from '@shared/types';

// Whitelisted, typed API exposed to the renderer. The renderer has no direct
// access to Node, Electron, the filesystem, or raw secret values.
const api = {
  getSchema: (): Promise<{ schema: XenonSchema; meta: SchemaMeta; secretDescriptors: SecretDescriptor[] }> =>
    ipcRenderer.invoke(IPC.schemaGet),

  profiles: {
    list: (): Promise<Profile[]> => ipcRenderer.invoke(IPC.profilesList),
    save: (p: Profile): Promise<Profile> => ipcRenderer.invoke(IPC.profileSave, p),
    delete: (id: string): Promise<Profile[]> => ipcRenderer.invoke(IPC.profileDelete, id),
    duplicate: (id: string): Promise<Profile | null> => ipcRenderer.invoke(IPC.profileDuplicate, id),
    export: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.profileExport, id),
    import: (): Promise<{ profiles: Profile[]; importedIds: string[] }> => ipcRenderer.invoke(IPC.profileImport),
    exportConfigYaml: (p: Profile): Promise<boolean> => ipcRenderer.invoke(IPC.exportConfigYaml, p)
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
    resolvedAppiumHome: (p: Profile): Promise<{ path: string; source: string }> =>
      ipcRenderer.invoke(IPC.resolvedAppiumHome, p)
  },

  toolchain: {
    check: (p?: Profile): Promise<ToolCheck[]> => ipcRenderer.invoke(IPC.toolchainCheck, p),
    preflight: (p: Profile): Promise<PreflightResult> => ipcRenderer.invoke(IPC.preflight, p)
  },

  setup: {
    install: (opts: {
      appiumHome?: string;
      pluginSource?: 'local' | 'npm';
      drivers?: Array<'uiautomator2' | 'xcuitest'>;
    }): Promise<boolean> => ipcRenderer.invoke(IPC.setupInstall, opts)
  },

  // Event subscriptions. Each returns an unsubscribe function.
  onLog: (cb: (line: LogLine) => void) => subscribe(IPC.evtLog, cb),
  onServerState: (cb: (state: ServerState) => void) => subscribe(IPC.evtServerState, cb),
  onSetupProgress: (cb: (p: SetupProgress) => void) => subscribe(IPC.evtSetupProgress, cb),
  onMenuAction: (cb: (a: MenuAction) => void) => subscribe(IPC.evtMenuAction, cb)
};

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('xenon', api);

export type XenonApi = typeof api;
