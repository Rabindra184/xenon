import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Profile, SecretDescriptor, SecretKey, SetupProgress } from '@shared/types';
import { SettingsForm } from './components/SettingsForm';
import { SecretsPanel } from './components/SecretsPanel';
import { EnvVarsEditor } from './components/EnvVarsEditor';
import { HealthPanel } from './components/HealthPanel';
import { LogConsole } from './components/LogConsole';
import { ProfileList } from './components/ProfileList';
import { StatusBar } from './components/StatusBar';
import { LaunchPreview } from './components/LaunchPreview';
import { parsePort, validate } from './validation';
import { cn } from './cn';
import { SETUP_INTERRUPTED, iphoneSetupSkipped, mergeProgress, setupSummary } from './setupProgress';
import { STATUS_DOT, STATUS_LABEL, formatUptime, isServerActive } from './serverStatus';
import { blockedReason, blockerLines, showsBlockerList } from './readiness';
import { useReadiness } from './useReadiness';
import { focusSetting } from './focusSetting';
import { pluginVersionLabel } from './pluginVersion';
import { useProfiles } from './hooks/useProfiles';
import { useServer, useStartFlow } from './hooks/useServer';
import { usePreferences } from './hooks/usePreferences';
import { useEffectiveSchema } from './hooks/useEffectiveSchema';
import type { Place } from './navigation';
import { Toaster } from './components/ui/Toaster';
import { toast } from './components/ui/toastStore';
import { Button } from './components/ui/Button';
import { Download, FolderOpen, OctagonAlert, Plus, Upload } from 'lucide-react';

type Tab = 'settings' | 'secrets' | 'health' | 'logs';
const TABS: { id: Tab; label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'secrets', label: 'Secrets & Env' },
  { id: 'health', label: 'Health' },
  { id: 'logs', label: 'Logs' }
];

export default function App() {
  const profileApi = useProfiles();
  const { profiles, activeId, draft } = profileApi;
  const server = useServer();
  const { state: serverState, logs } = server;
  const serverStatus = serverState.status;
  // The option list and the footer's plugin version, read from the profile's Appium folder.
  const {
    schema,
    schemaInfo,
    installedPluginVersion,
    refresh: refreshInstalled
  } = useEffectiveSchema(draft, serverStatus);
  // Nothing on screen reads the preferences yet; mounting the hook keeps its subscription running.
  usePreferences();
  const [secretDescriptors, setSecretDescriptors] = useState<SecretDescriptor[]>([]);
  const [tab, setTab] = useState<Tab>('settings');
  // A setting to put the cursor in once the screen that holds it is drawn.
  const [pendingFocus, setPendingFocus] = useState<{ path: string } | null>(null);
  // Things that can change whether Start is allowed (see useReadiness).
  const [focusTick, setFocusTick] = useState(0);
  const [recheckTick, setRecheckTick] = useState(0);
  const [installing, setInstalling] = useState(false);
  // Setup progress lives here, not in HealthPanel, so the rows survive switching
  // tabs mid-run. The ref holds the latest rows so handleInstall can read the
  // final ones without waiting on a render.
  const [setupProgress, setSetupProgress] = useState<SetupProgress[]>([]);
  const setupProgressRef = useRef<SetupProgress[]>([]);
  // Bumped when a run ends so the Health checks re-run (the iPhone row reads the
  // installed plugin and go-ios, both of which the run just changed).
  const [setupRuns, setSetupRuns] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Menu actions arrive on a subscription that mounts once, so the handler
  // reads live values through refs rather than stale closure captures.
  const draftRef = useRef<Profile | null>(null);
  const stateRef = useRef(serverState);
  const actionsRef = useRef<Record<string, () => void>>({});

  // Live setup progress from the main process. A step reports when it starts and
  // again when it ends; merging keeps it to one row per step.
  useEffect(
    () =>
      window.xenon.onSetupProgress((p) => {
        setupProgressRef.current = mergeProgress(setupProgressRef.current, p);
        setSetupProgress(setupProgressRef.current);
      }),
    []
  );

  // Only the secret descriptors come from here; the option list follows the
  // active profile's Appium folder and is fetched by useEffectiveSchema.
  useEffect(() => {
    void window.xenon.getSchema().then((s) => setSecretDescriptors(s.secretDescriptors));
  }, []);

  useEffect(
    () =>
      window.xenon.onMenuAction((a) => {
        switch (a) {
          case 'tab-settings':
            return setTab('settings');
          case 'tab-secrets':
            return setTab('secrets');
          case 'tab-health':
            return setTab('health');
          case 'tab-logs':
            return setTab('logs');
          case 'new-profile':
            return actionsRef.current.create?.();
          case 'import-profiles':
            return actionsRef.current.import?.();
          case 'export-profile':
            return actionsRef.current.export?.();
          case 'launch-preview':
            return setPreviewOpen(true);
          case 'open-dashboard': {
            const url = stateRef.current.dashboardUrl;
            if (url) void window.xenon.server.openDashboard(url);
            return;
          }
          case 'toggle-server': {
            const s = stateRef.current.status;
            if (s === 'stopped' || s === 'crashed') actionsRef.current.start?.();
            else actionsRef.current.stop?.();
            return;
          }
        }
      }),
    []
  );

  // Regaining focus is when a plugin upgrade run in a terminal becomes visible
  // to this window (see useEffectiveSchema), and when Start's checks look again.
  useEffect(() => {
    const onFocus = () => {
      void refreshInstalled();
      setFocusTick((n) => n + 1);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshInstalled]);

  // The port input holds its own text so a half-typed or cleared value never
  // reaches the profile as NaN. Re-seeded when a different profile is selected.
  const [portText, setPortText] = useState('');
  useEffect(() => {
    const p = profiles.find((x) => x.id === activeId) ?? null;
    setPortText(p ? String(p.server.port) : '');
  }, [activeId, profiles]);

  // What an empty APPIUM_HOME actually resolves to on this machine, so "auto"
  // is visible rather than magic.
  const [autoHome, setAutoHome] = useState<{ path: string; source: string; display: string } | null>(null);
  useEffect(() => {
    if (!draft) return;
    let live = true;
    window.xenon.server.resolvedAppiumHome(draft).then((r) => live && setAutoHome(r));
    return () => {
      live = false;
    };
  }, [draft?.id, draft?.server.appiumHome]);

  const portParse = parsePort(portText);
  const portError = portParse.ok ? null : portParse.error;

  const onPortChange = (text: string) => {
    setPortText(text);
    const res = parsePort(text);
    if (res.ok) updateServerField('port', res.value);
  };

  const updateSetting = (key: string, value: unknown) =>
    profileApi.update((p) => {
      const settings = { ...p.settings };
      if (value === undefined) delete settings[key];
      else settings[key] = value;
      return { ...p, settings };
    });

  const updateServerField = <K extends keyof Profile['server']>(field: K, value: Profile['server'][K]) =>
    profileApi.update((p) => ({ ...p, server: { ...p.server, [field]: value } }));

  const toggleSecretRef = (key: SecretKey, on: boolean) =>
    profileApi.update((p) => {
      const set = new Set(p.secretRefs);
      on ? set.add(key) : set.delete(key);
      return { ...p, secretRefs: Array.from(set) };
    });

  const updateEnv = (env: Record<string, string>) => profileApi.update((p) => ({ ...p, env }));

  const handleInstall = async () => {
    if (!draft) return;
    setupProgressRef.current = [];
    setSetupProgress([]);
    setInstalling(true);
    try {
      let r;
      try {
        r = await window.xenon.setup.install({
          profile: draft,
          pluginSource: 'local',
          drivers: ['uiautomator2', 'xcuitest']
        });
      } catch {
        // The request itself failed, so there is no result to summarise. The rows say how far it got.
        toast(SETUP_INTERRUPTED.message, SETUP_INTERRUPTED.kind);
        return;
      }
      const summary = setupSummary(r, { iphoneSkipped: iphoneSetupSkipped(setupProgressRef.current) });
      toast(summary.message, summary.kind);
      await refreshInstalled();
      // Main re-detects the folder after an install; keep the card's path in step.
      // The profile on screen now, which may not be the one Set up was clicked on.
      const shown = draftRef.current;
      if (shown) {
        const home = await window.xenon.server.resolvedAppiumHome(shown);
        if (draftRef.current?.id === shown.id) setAutoHome(home);
      }
    } finally {
      setInstalling(false);
      // Also what tells readiness a setup finished.
      setSetupRuns((n) => n + 1);
    }
  };

  const schemaIssues = useMemo(() => (schema && draft ? validate(schema, draft) : []), [schema, draft]);
  // An unparseable port never reaches the profile, so it can't come back from
  // validate() — surface it here so Start is still blocked while it's invalid.
  const validationIssues = useMemo(
    () =>
      portError
        ? [
            ...schemaIssues.filter((i) => i.path !== 'server.port'),
            { path: 'server.port', label: 'Port', message: portError }
          ]
        : schemaIssues,
    [schemaIssues, portError]
  );
  const settingIssueMap = useMemo(
    () => Object.fromEntries(validationIssues.map((i) => [i.path, i.message])),
    [validationIssues]
  );

  const { readiness, checking, refreshNow } = useReadiness(
    draft,
    { focus: focusTick, setup: setupRuns, recheck: recheckTick },
    serverStatus,
    installing
  );

  // Until the sidebar shell, the places are the tabs: Setup is Health.
  const go = (place: Place) => {
    switch (place) {
      case 'home':
      case 'settings':
        return setTab('settings'); // there is no Home yet; Settings is where the app opens
      case 'setup':
        return setTab('health');
      case 'logs':
        return setTab('logs');
    }
  };
  const focus = useCallback((path: string) => setPendingFocus({ path }), []);

  const start = useStartFlow({
    draft,
    issues: validationIssues,
    readiness,
    checking,
    installing,
    status: serverStatus,
    refreshNow,
    flush: profileApi.flush,
    resetLogs: server.clearLogs,
    go,
    focus
  });
  const { requestStart } = start;

  // The screen a setting is on may only just have been drawn, so focus after the commit.
  useEffect(() => {
    if (pendingFocus) focusSetting(pendingFocus.path);
  }, [pendingFocus]);

  // Keep the menu-action refs pointing at the current state and handlers.
  draftRef.current = draft;
  stateRef.current = serverState;
  actionsRef.current = {
    create: () => void profileApi.create(),
    import: () => void profileApi.importProfiles(),
    export: () => draftRef.current && void profileApi.exportProfile(draftRef.current.id),
    start: () => void requestStart(),
    stop: () => void server.stop()
  };

  const runningId = isServerActive(serverState.status) ? serverState.profileId : null;
  const ready = schema && draft;

  // 1s uptime ticker, only while the server is running.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (serverState.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [serverState.status]);

  const dashboardHint = useMemo(() => {
    if (!draft) return '';
    return `http://${draft.settings.bindHostOrIp || '127.0.0.1'}:${draft.server.port}/xenon/`;
  }, [draft]);

  return (
    <div className="flex h-full bg-app text-ink">
      {/* Sidebar spans the full window height; the top 40px is the traffic-light drag region. */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-surface">
        <div className="titlebar-drag h-10 shrink-0" />
        <div className="flex min-h-0 flex-1 flex-col p-3 pt-0">
          <div data-testid="sidebar-brand" className="mb-4 flex items-center gap-2 px-1">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 font-mono text-sm font-semibold text-accent">
              X
            </div>
            <span className="text-sm font-semibold tracking-wide text-ink">Xenon Control</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <ProfileList
              profiles={profiles}
              activeId={activeId}
              runningId={runningId}
              onSelect={profileApi.select}
              onCreate={profileApi.create}
              onDuplicate={profileApi.duplicate}
              onDelete={profileApi.remove}
            />
          </div>
          <div data-testid="sidebar-status" className="mt-3 rounded-lg border border-line bg-surface2 p-3 text-xs">
            <div className="flex items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[serverState.status])} />
              <span className="font-medium text-ink">{STATUS_LABEL[serverState.status]}</span>
              {serverState.port != null && serverState.status === 'running' && (
                <span className="font-mono text-muted">:{serverState.port}</span>
              )}
            </div>
            {serverState.status === 'running' && serverState.startedAt && (
              <div className="mt-1 text-dim">up {formatUptime(now - serverState.startedAt)}</div>
            )}
            <div className="mt-1 text-dim">plugin {pluginVersionLabel(installedPluginVersion)}</div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="titlebar-drag h-10 shrink-0" />
          {!ready ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              {profiles.length === 0 ? (
                <>
                  <p className="text-sm text-muted">No profiles yet.</p>
                  <Button variant="primary" onClick={profileApi.create} icon={<Plus size={14} />}>
                    New Profile
                  </Button>
                </>
              ) : (
                <p className="text-sm text-dim">Loading…</p>
              )}
            </div>
          ) : (
            <>
              {/* Profile header */}
              <div className="border-b border-line px-6 py-3">
                <div className="flex items-center gap-3">
                  <input
                    data-testid="profile-name"
                    value={draft.name}
                    onChange={(e) => profileApi.rename(draft.id, e.target.value)}
                    className="focus-ring min-w-0 flex-1 rounded bg-transparent text-lg font-semibold"
                  />
                  <div className="titlebar-no-drag flex shrink-0 items-center gap-1">
                    <HeaderBtn onClick={() => profileApi.exportProfile(draft.id)} icon={<Download size={14} />} label="Export" />
                    <HeaderBtn onClick={profileApi.importProfiles} icon={<Upload size={14} />} label="Import" />
                    <HeaderBtn
                      onClick={() => window.xenon.server.openPath('appiumHome', draft)}
                      icon={<FolderOpen size={14} />}
                      label="APPIUM_HOME"
                    />
                    <HeaderBtn
                      onClick={() => window.xenon.server.openPath('logs')}
                      icon={<FolderOpen size={14} />}
                      label="Log Folder"
                    />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted">
                  <label className="flex items-center gap-1.5">
                    Port
                    <input
                      data-setting-key="server.port"
                      type="number"
                      value={portText}
                      aria-invalid={!!portError}
                      aria-label="Port"
                      title={portError ?? undefined}
                      onChange={(e) => onPortChange(e.target.value)}
                      className={cn(
                        'focus-ring w-20 rounded border bg-surface2 px-1.5 py-0.5 text-ink',
                        portError ? 'border-danger' : 'border-dim'
                      )}
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    Base path
                    <input
                      data-setting-key="server.basePath"
                      value={draft.server.basePath}
                      onChange={(e) => updateServerField('basePath', e.target.value)}
                      className="focus-ring w-28 rounded border border-dim bg-surface2 px-1.5 py-0.5 text-ink"
                    />
                  </label>
                  <label className="flex flex-1 items-center gap-1.5">
                    APPIUM_HOME
                    <input
                      data-testid="appium-home"
                      value={draft.server.appiumHome}
                      placeholder={autoHome && !draft.server.appiumHome ? `auto: ${autoHome.path}` : '(auto-detected)'}
                      title={
                        draft.server.appiumHome
                          ? 'Explicit override for this profile'
                          : autoHome
                            ? `Auto-detected (${autoHome.source}): ${autoHome.path}`
                            : undefined
                      }
                      onChange={(e) => updateServerField('appiumHome', e.target.value)}
                      className="focus-ring min-w-0 flex-1 rounded border border-dim bg-surface2 px-1.5 py-0.5 text-ink placeholder:text-dim"
                    />
                  </label>
                  <span className="font-mono text-dim">→ {dashboardHint}</span>
                </div>
              </div>

              {/* Tabs */}
              <div role="tablist" aria-label="Profile sections" className="flex gap-1 border-b border-line px-6">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'focus-ring border-b-2 px-3 py-2 text-sm',
                      tab === t.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'
                    )}
                  >
                    {t.label}
                    {t.id === 'logs' && serverState.status === 'crashed' && (
                      <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-danger align-middle" />
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
                {tab === 'settings' && (
                  <>
                    {validationIssues.length > 0 && (
                      // Words in the text colour on the danger tint (danger text there is under 4.5:1 in
                      // light); the danger colour goes on the border and the icon, as in Banner.
                      <div className="mb-4 flex items-start gap-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-ink">
                        <OctagonAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
                        <div className="min-w-0 flex-1">
                          <strong>{validationIssues.length} validation {validationIssues.length === 1 ? 'issue' : 'issues'}:</strong>
                          <ul className="mt-1 list-disc pl-5">
                            {validationIssues.map((i, idx) => (
                              <li key={idx}>
                                {i.label}: {i.message}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                    <SettingsForm
                      schema={schema}
                      schemaInfo={schemaInfo}
                      values={draft.settings}
                      onChange={updateSetting}
                      issues={settingIssueMap}
                    />
                  </>
                )}
                {tab === 'secrets' && (
                  <div className="space-y-6">
                    <SecretsPanel
                      descriptors={secretDescriptors}
                      selected={draft.secretRefs}
                      onToggleSelected={toggleSecretRef}
                    />
                    <EnvVarsEditor env={draft.env ?? {}} onChange={updateEnv} />
                  </div>
                )}
                {tab === 'health' && (
                  <>
                    {readiness &&
                      showsBlockerList({ readiness, serverActive: isServerActive(serverState.status), installing }) && (
                      <div
                        data-testid="readiness-blockers"
                        className="mb-4 flex items-start gap-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-ink"
                      >
                        <OctagonAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
                        <div className="min-w-0 flex-1">
                          <strong>Why Start is off:</strong>
                          <ul className="mt-1 list-disc pl-5">
                            {blockerLines(readiness).map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                    <HealthPanel
                      onInstall={handleInstall}
                      installing={installing}
                      serverActive={isServerActive(serverState.status)}
                      progress={setupProgress}
                      setupRuns={setupRuns}
                      profile={draft}
                      appiumHomeDisplay={autoHome?.display}
                      onRecheck={() => setRecheckTick((n) => n + 1)}
                    />
                  </>
                )}
                {tab === 'logs' && (
                  <LogConsole
                    logs={logs}
                    onClear={server.clearLogs}
                    onStart={serverState.status === 'stopped' || serverState.status === 'crashed' ? requestStart : undefined}
                  />
                )}
              </div>
            </>
          )}

          <StatusBar
            state={serverState}
            busy={start.busy || server.stopPending}
            blockedReason={blockedReason(start.decision)}
            startError={start.startError}
            onStart={requestStart}
            onStop={server.stop}
            onPreview={() => setPreviewOpen(true)}
          />
      </main>

      {previewOpen && draft && <LaunchPreview profile={draft} onClose={() => setPreviewOpen(false)} />}
      <Toaster />
    </div>
  );
}

function HeaderBtn({ onClick, icon, label }: { onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="focus-ring inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:bg-surface2 hover:text-ink"
    >
      {icon}
      {label}
    </button>
  );
}
