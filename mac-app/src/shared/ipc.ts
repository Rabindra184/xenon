// Canonical list of IPC channel names, shared between main and preload so the
// two never drift. `invoke` channels are request/response; `event` channels are
// main -> renderer pushes.
export const IPC = {
  // schema
  schemaGet: 'schema:get',
  // profiles
  profilesList: 'profiles:list',
  profileSave: 'profiles:save',
  profileDelete: 'profiles:delete',
  profileDuplicate: 'profiles:duplicate',
  profileExport: 'profiles:export',
  profileImport: 'profiles:import',
  exportConfigYaml: 'profiles:exportConfigYaml',
  // which profile the window has open, remembered per Mac across a closed window and a relaunch
  profileOpenGet: 'profiles:openGet',
  profileOpenSet: 'profiles:openSet',
  // secrets (write + status only; raw values never returned to renderer)
  secretsStatus: 'secrets:status',
  secretSet: 'secrets:set',
  secretClear: 'secrets:clear',
  // server lifecycle
  serverStart: 'server:start',
  serverStop: 'server:stop',
  serverState: 'server:state',
  launchPreview: 'server:launchPreview',
  openDashboard: 'server:openDashboard',
  openPath: 'server:openPath',
  resolvedAppiumHome: 'server:resolvedAppiumHome',
  installedPluginVersion: 'server:installedPluginVersion',
  // preferences
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  // toolchain / setup
  toolchainCheck: 'toolchain:check',
  preflight: 'toolchain:preflight',
  setupInstall: 'setup:install',
  // events (main -> renderer)
  evtLog: 'evt:log',
  evtServerState: 'evt:serverState',
  evtSetupProgress: 'evt:setupProgress',
  evtMenuAction: 'evt:menuAction',
  evtPrefs: 'evt:prefs'
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
