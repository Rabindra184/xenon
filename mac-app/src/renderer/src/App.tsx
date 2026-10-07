import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Profile, SecretDescriptor, SecretKey, SetupProgress } from '@shared/types';
import { LaunchPreview } from './components/LaunchPreview';
import { ReadinessBlockers } from './components/ReadinessBlockers';
import { ProfilesSheet } from './sheets/Profiles';
import { Home } from './screens/Home';
import { Logs } from './screens/Logs';
import { Settings, type SettingsTab } from './screens/Settings';
import { Setup } from './screens/Setup';
import { AppShell } from './AppShell';
import { parsePort, validate } from './validation';
import { SETUP_INTERRUPTED, iphoneSetupSkipped, mergeProgress, setupSummary } from './setupProgress';
import { isServerActive } from './serverStatus';
import { blockedReason, showsBlockerList } from './readiness';
import { useReadiness } from './useReadiness';
import { pluginVersionLine } from './pluginVersion';
import { exportNotice } from './exportNotice';
import { setupNeedsAttention, type Place } from './navigation';
import { useProfiles } from './hooks/useProfiles';
import { useServer, useStartFlow } from './hooks/useServer';
import { usePreferences } from './hooks/usePreferences';
import { useEffectiveSchema } from './hooks/useEffectiveSchema';
import { useCrashAlert } from './hooks/useCrashAlert';
import { usePendingFocus } from './hooks/usePendingFocus';
import { useMenuActions } from './hooks/useMenuActions';
import { SHELL } from './copy/shell';
import { Toaster } from './components/ui/Toaster';
import { toast } from './components/ui/toastStore';
import { Button } from './components/ui/Button';
import { EmptyState } from './components/ui/EmptyState';
import { Plus } from 'lucide-react';

export default function App() {
  const [place, setPlace] = useState<Place>('home');
  const crash = useCrashAlert(place);
  const profileApi = useProfiles();
  const { profiles, activeId, draft } = profileApi;
  const server = useServer({ onStatus: crash.onStatus });
  const { state: serverState, logs } = server;
  const serverStatus = serverState.status;
  // The option list and Setup's plugin version, read from the profile's Appium folder.
  const {
    schema,
    schemaInfo,
    installedPluginVersion,
    refresh: refreshInstalled
  } = useEffectiveSchema(draft, serverStatus);
  const { prefs, setPrefs } = usePreferences();
  const [secretDescriptors, setSecretDescriptors] = useState<SecretDescriptor[]>([]);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('all');
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

  // The latest values, for handlers that run after an await.
  const draftRef = useRef<Profile | null>(null);
  const profilesOpenRef = useRef(false);
  draftRef.current = draft;
  profilesOpenRef.current = profilesOpen;

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
  // Read when a profile is opened and not when a save comes back, which would overwrite what is being typed.
  useEffect(() => {
    setPortText(draft ? String(draft.server.port) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id]);

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

  const updateServerField = <K extends keyof Profile['server']>(field: K, value: Profile['server'][K]) =>
    profileApi.update((p) => ({ ...p, server: { ...p.server, [field]: value } }));

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

  const { readiness, checking, refreshNow } = useReadiness(
    draft,
    { focus: focusTick, setup: setupRuns, recheck: recheckTick },
    serverStatus,
    installing
  );

  // Every setting, the port and base path included, is in Settings' first tab.
  const focusWhenDrawn = usePendingFocus();
  const focus = useCallback(
    (path: string) => {
      setSettingsTab('all');
      focusWhenDrawn(path);
    },
    [focusWhenDrawn]
  );

  // Export saves the open profile. What the file leaves out is told on the sheet; from the menu
  // the sheet is closed, so it opens to say so.
  const exportCurrentProfile = async () => {
    const current = draftRef.current;
    if (!current) return;
    const { saved, leftOut } = await profileApi.exportProfile(current.id);
    setExportLeftOut(saved ? leftOut : []);
    if (saved && leftOut.length > 0 && !profilesOpenRef.current) setProfilesOpen(true);
  };

  // Saves the Appium config Start would write, where the person chooses.
  const exportConfig = async () => {
    const current = draftRef.current;
    if (current && (await window.xenon.profiles.exportConfigYaml(current))) toast(SHELL.settings.configSaved);
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
  const serverActive = isServerActive(serverStatus);

  // The application menu and the menu-bar icon. Nothing is acted on until the
  // profiles and the server's status are known; an action sent sooner waits.
  useMenuActions(
    {
      'new-profile': () => void profileApi.create(),
      'import-profiles': () => void profileApi.importProfiles(),
      'export-profile': () => void exportCurrentProfile(),
      'manage-profiles': () => setProfilesOpen(true),
      'launch-preview': () => setPreviewOpen(true),
      'export-config': () => void exportConfig(),
      'toggle-server': () => void (serverActive ? server.stop() : requestStart())
    },
    setPlace,
    profileApi.loaded && server.loaded
  );

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
          logsAlert: crash.logsAlert,
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
          home: draft ? <Home state={serverState} blockers={blockers} /> : noProfile,
          setup: draft ? (
            <Setup
              versionLine={pluginVersionLine(installedPluginVersion)}
              blockers={blockers}
              health={{
                onInstall: handleInstall,
                installing,
                serverActive,
                progress: setupProgress,
                setupRuns,
                profile: draft,
                appiumHomeDisplay: autoHome?.display,
                onRecheck: () => setRecheckTick((n) => n + 1)
              }}
            />
          ) : (
            noProfile
          ),
          settings: draft ? (
            <Settings
              profile={draft}
              tab={settingsTab}
              onTab={setSettingsTab}
              issues={validationIssues}
              portText={portText}
              onPortChange={onPortChange}
              schema={schema}
              schemaInfo={schemaInfo}
              onSetting={updateSetting}
              autoHome={autoHome}
              onServerField={updateServerField}
              onPreview={() => setPreviewOpen(true)}
              onExportConfig={() => void exportConfig()}
              serverActive={serverActive}
              secretDescriptors={secretDescriptors}
              onToggleSecret={toggleSecretRef}
              onEnv={updateEnv}
              technicalDetails={prefs.technicalDetails}
              onTechnicalDetails={(technicalDetails) => setPrefs({ technicalDetails })}
            />
          ) : (
            noProfile
          ),
          logs: draft ? (
            <Logs
              logs={logs}
              onClear={server.clearLogs}
              onStart={serverActive ? undefined : requestStart}
              technicalDetails={prefs.technicalDetails}
            />
          ) : (
            noProfile
          )
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
