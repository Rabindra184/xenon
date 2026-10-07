import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PreflightResult, Profile, SecretDescriptor, SecretKey, SetupProgress } from '@shared/types';
import { SettingsForm } from './components/SettingsForm';
import { SecretsPanel } from './components/SecretsPanel';
import { EnvVarsEditor } from './components/EnvVarsEditor';
import { HealthPanel } from './components/HealthPanel';
import { LogConsole } from './components/LogConsole';
import { LaunchPreview } from './components/LaunchPreview';
import { ServerGroup } from './components/ServerGroup';
import { ProfilesSheet } from './sheets/Profiles';
import { AppShell } from './AppShell';
import { parsePort, validate } from './validation';
import { SETUP_INTERRUPTED, iphoneSetupSkipped, mergeProgress, setupSummary } from './setupProgress';
import { STATUS_HINT, STATUS_WORD, formatUptime, isServerActive } from './serverStatus';
import { blockedReason, blockerLines, showsBlockerList } from './readiness';
import { useReadiness } from './useReadiness';
import { focusSetting } from './focusSetting';
import { pluginVersionLine } from './pluginVersion';
import { exportNotice } from './exportNotice';
import { crashAlert, setupNeedsAttention, type Place } from './navigation';
import { useProfiles } from './hooks/useProfiles';
import { useServer, useStartFlow } from './hooks/useServer';
import { usePreferences } from './hooks/usePreferences';
import { useEffectiveSchema } from './hooks/useEffectiveSchema';
import { SHELL } from './copy/shell';
import { Toaster } from './components/ui/Toaster';
import { toast } from './components/ui/toastStore';
import { Button } from './components/ui/Button';
import { EmptyState } from './components/ui/EmptyState';
import { TabList, TabPanel, TabTrigger, Tabs } from './components/ui/Tabs';
import { ExternalLink, FolderOpen, OctagonAlert, Plus } from 'lucide-react';

/** The tabs inside Settings. */
type SettingsTab = 'all' | 'keys';

/** How many frames a setting to focus is looked for before giving up. */
const FOCUS_TRIES = 10;

export default function App() {
  const profileApi = useProfiles();
  const { profiles, activeId, draft } = profileApi;
  const server = useServer();
  const { state: serverState, logs } = server;
  const serverStatus = serverState.status;
  // The option list and Setup's plugin version, read from the profile's Appium folder.
  const {
    schema,
    schemaInfo,
    installedPluginVersion,
    refresh: refreshInstalled
  } = useEffectiveSchema(draft, serverStatus);
  const { prefs } = usePreferences();
  const [secretDescriptors, setSecretDescriptors] = useState<SecretDescriptor[]>([]);
  const [place, setPlace] = useState<Place>('home');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('all');
  // A setting to put the cursor in once the screen that holds it is drawn.
  const [pendingFocus, setPendingFocus] = useState<{ path: string } | null>(null);
  // Things that can change whether Start is allowed (see useReadiness).
  const [focusTick, setFocusTick] = useState(0);
  const [recheckTick, setRecheckTick] = useState(0);
  const [installing, setInstalling] = useState(false);
  // Setup progress lives here, not in HealthPanel, so the rows survive moving
  // between places mid-run. The ref holds the latest rows so handleInstall can
  // read the final ones without waiting on a render.
  const [setupProgress, setSetupProgress] = useState<SetupProgress[]>([]);
  const setupProgressRef = useRef<SetupProgress[]>([]);
  // Bumped when a run ends so the Setup checks re-run (the iPhone row reads the
  // installed plugin and go-ios, both of which the run just changed).
  const [setupRuns, setSetupRuns] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  // The secret values the last export left out; the sheet says so until it is closed.
  const [exportLeftOut, setExportLeftOut] = useState<string[]>([]);

  // Menu actions arrive on a subscription that mounts once, so the handler
  // reads live values through refs rather than stale closure captures.
  const draftRef = useRef<Profile | null>(null);
  const stateRef = useRef(serverState);
  const actionsRef = useRef<Record<string, () => void>>({});
  const profilesOpenRef = useRef(false);

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

  // The menu still names the old tabs; each opens the place that now holds it.
  useEffect(
    () =>
      window.xenon.onMenuAction((a) => {
        switch (a) {
          case 'tab-settings':
            setSettingsTab('all');
            return setPlace('settings');
          case 'tab-secrets':
            setSettingsTab('keys');
            return setPlace('settings');
          case 'tab-health':
            return setPlace('setup');
          case 'tab-logs':
            return setPlace('logs');
          case 'new-profile':
            return actionsRef.current.create?.();
          case 'import-profiles':
            return actionsRef.current.import?.();
          case 'export-profile':
            return actionsRef.current.export?.();
          case 'manage-profiles':
            return setProfilesOpen(true);
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

  // What an empty Appium folder actually resolves to on this machine, so
  // "automatic" is visible rather than magic.
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

  // Every setting, the port and base path included, is in Settings' first tab.
  const focus = useCallback((path: string) => {
    setSettingsTab('all');
    setPendingFocus({ path });
  }, []);

  // Export saves the open profile. What the file leaves out is told on the sheet; from the menu
  // the sheet is closed, so it opens to say so.
  const exportCurrentProfile = async () => {
    const current = draftRef.current;
    if (!current) return;
    const { saved, leftOut } = await profileApi.exportProfile(current.id);
    setExportLeftOut(saved ? leftOut : []);
    if (saved && leftOut.length > 0 && !profilesOpenRef.current) setProfilesOpen(true);
  };

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
    go: setPlace,
    focus
  });
  const { requestStart } = start;

  // The place a setting is on may not be drawn yet: Radix mounts a newly chosen
  // tab's panel in a render of its own, after this commit. So look on each frame
  // until the setting is there, for a few frames at most.
  useEffect(() => {
    if (!pendingFocus) return;
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      if (focusSetting(pendingFocus.path) || ++tries >= FOCUS_TRIES) return;
      frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [pendingFocus]);

  // Logs' dot: on when the server stops unexpectedly, off once Logs is open.
  // The previous status is read before the update is queued, since the updater runs later.
  const [logsAlert, setLogsAlert] = useState(false);
  const lastStatus = useRef(serverStatus);
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = serverStatus;
    setLogsAlert((alert) => crashAlert({ status: prev, alert }, { status: serverStatus, place }));
  }, [serverStatus, place]);

  // Keep the menu-action refs pointing at the current state and handlers.
  draftRef.current = draft;
  stateRef.current = serverState;
  profilesOpenRef.current = profilesOpen;
  actionsRef.current = {
    create: () => void profileApi.create(),
    import: () => void profileApi.importProfiles(),
    export: () => void exportCurrentProfile(),
    start: () => void requestStart(),
    stop: () => void server.stop()
  };

  // 1s uptime ticker, only while the server is running.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (serverState.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [serverState.status]);

  const serverActive = isServerActive(serverStatus);
  const blockers =
    readiness && showsBlockerList({ readiness, serverActive, installing }) ? (
      <ReadinessBlockers readiness={readiness} />
    ) : null;

  // The lists show the open profile as edited on screen: a rename or a new port is there at once,
  // not after the save that follows typing.
  const shownProfiles = useMemo(
    () => profiles.map((p) => (draft && p.id === draft.id ? draft : p)),
    [profiles, draft]
  );
  // The switcher waits for the profiles, so it never says "No profile" for the moment before they load.
  const switcherReady = profileApi.loaded && (draft !== null || profiles.length === 0);

  // Until the profiles have loaded (or when there are none), every place says so.
  const noProfile = (
    <EmptyState
      title={profiles.length === 0 ? SHELL.noProfiles : SHELL.loading}
      action={
        profiles.length === 0 ? (
          <Button variant="primary" onClick={profileApi.create} icon={<Plus size={14} aria-hidden="true" />}>
            {SHELL.newProfile}
          </Button>
        ) : undefined
      }
    />
  );

  // Home, until its own screen: the status, what to do while running or after a crash, and why Start is off.
  const home = (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">{STATUS_WORD[serverStatus]}</h1>
        {STATUS_HINT[serverStatus] && <p className="mt-1 text-sm text-muted">{STATUS_HINT[serverStatus]}</p>}
        {serverStatus === 'running' && serverState.port != null && serverState.startedAt && (
          <p className="mt-1 text-sm text-muted">
            {SHELL.home.runningOn(serverState.port, formatUptime(now - serverState.startedAt))}
          </p>
        )}
      </div>
      {serverStatus === 'running' && serverState.dashboardUrl && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={() => window.xenon.server.openDashboard(serverState.dashboardUrl!)}
            icon={<ExternalLink size={14} aria-hidden="true" />}
          >
            {SHELL.home.openDashboard}
          </Button>
          <span className="font-mono text-xs text-muted">{serverState.dashboardUrl}</span>
        </div>
      )}
      {serverStatus === 'crashed' && serverState.lastError && (
        <div>
          <p className="text-sm font-medium text-ink">{SHELL.home.lastMessage}</p>
          <p data-raw className="mt-1 break-words font-mono text-xs text-muted">
            {serverState.lastError}
          </p>
        </div>
      )}
      {blockers}
    </div>
  );

  const versionLine = pluginVersionLine(installedPluginVersion);
  const setup = draft && (
    <div className="space-y-4">
      {versionLine && (
        <p data-testid="plugin-version" className="text-sm font-medium text-ink">
          {versionLine}
        </p>
      )}
      {blockers}
      <HealthPanel
        onInstall={handleInstall}
        installing={installing}
        serverActive={serverActive}
        progress={setupProgress}
        setupRuns={setupRuns}
        profile={draft}
        appiumHomeDisplay={autoHome?.display}
        onRecheck={() => setRecheckTick((n) => n + 1)}
      />
    </div>
  );

  const settings = draft && (
    <Tabs value={settingsTab} onValueChange={(v) => setSettingsTab(v === 'keys' ? 'keys' : 'all')}>
      <TabList aria-label={SHELL.settings.sections} className="mb-5">
        <TabTrigger value="all">{SHELL.settings.allSettings}</TabTrigger>
        <TabTrigger value="keys">{SHELL.settings.keysAndAccounts}</TabTrigger>
      </TabList>
      <TabPanel value="all" className="space-y-6">
        {validationIssues.length > 0 && (
          // Words in the text colour on the danger tint (danger text there is under 4.5:1 in
          // light); the danger colour goes on the border and the icon, as in Banner.
          <div className="flex items-start gap-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-ink">
            <OctagonAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <strong>{SHELL.settings.issues(validationIssues.length)}</strong>
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
        <ServerGroup
          profile={draft}
          portText={portText}
          onPortChange={onPortChange}
          issues={settingIssueMap}
          autoHome={autoHome}
          onServerField={updateServerField}
          onOpenAppiumFolder={() => window.xenon.server.openPath('appiumHome', draft)}
          onPreview={() => setPreviewOpen(true)}
          serverActive={serverActive}
        />
        {schema ? (
          <SettingsForm
            schema={schema}
            schemaInfo={schemaInfo}
            values={draft.settings}
            onChange={updateSetting}
            issues={settingIssueMap}
          />
        ) : (
          <p className="text-sm text-dim">{SHELL.loading}</p>
        )}
      </TabPanel>
      <TabPanel value="keys" className="space-y-6">
        <SecretsPanel descriptors={secretDescriptors} selected={draft.secretRefs} onToggleSelected={toggleSecretRef} />
        <EnvVarsEditor env={draft.env ?? {}} onChange={updateEnv} />
      </TabPanel>
    </Tabs>
  );

  const logsPlace = (
    <>
      <div className="mb-3 flex shrink-0 justify-end">
        <Button
          size="sm"
          onClick={() => window.xenon.server.openPath('logs')}
          icon={<FolderOpen size={14} aria-hidden="true" />}
        >
          {SHELL.logs.openLogFolder}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <LogConsole
          logs={logs}
          onClear={server.clearLogs}
          onStart={serverStatus === 'stopped' || serverStatus === 'crashed' ? requestStart : undefined}
        />
      </div>
    </>
  );

  return (
    <>
      <AppShell
        place={place}
        onPlace={setPlace}
        sidebar={{
          switcher: switcherReady
            ? {
                profiles: shownProfiles,
                activeId,
                onSelect: profileApi.select,
                onNew: () => void profileApi.create(),
                onManage: () => setProfilesOpen(true)
              }
            : null,
          setupAttention: setupNeedsAttention(readiness, installing),
          logsAlert,
          status: {
            state: serverState,
            busy: start.busy || server.stopPending,
            blockedReason: blockedReason(start.decision),
            startError: start.startError,
            onStart: requestStart,
            onStop: server.stop,
            onShowHome: () => setPlace('home')
          }
        }}
        places={{
          home: draft ? home : noProfile,
          setup: setup || noProfile,
          settings: settings || noProfile,
          logs: draft ? logsPlace : noProfile
        }}
      />
      <ProfilesSheet
        open={profilesOpen}
        onOpenChange={(open) => {
          setProfilesOpen(open);
          if (!open) setExportLeftOut([]);
        }}
        profiles={shownProfiles}
        activeId={activeId}
        onRename={profileApi.rename}
        onDuplicate={(id) => void profileApi.duplicate(id)}
        onDelete={(id) => void profileApi.remove(id)}
        onNew={() => void profileApi.create()}
        onImport={() => void profileApi.importProfiles()}
        onExport={() => void exportCurrentProfile()}
        notice={exportNotice(exportLeftOut, prefs.technicalDetails)}
      />
      {previewOpen && draft && <LaunchPreview profile={draft} onClose={() => setPreviewOpen(false)} />}
      <Toaster />
    </>
  );
}

/** Part A's list of why Start is off, on Home and on Setup. */
function ReadinessBlockers({ readiness }: { readiness: PreflightResult }) {
  return (
    <div
      data-testid="readiness-blockers"
      className="flex items-start gap-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-ink"
    >
      <OctagonAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <strong>{SHELL.home.whyStartIsOff}</strong>
        <ul className="mt-1 list-disc pl-5">
          {blockerLines(readiness).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
