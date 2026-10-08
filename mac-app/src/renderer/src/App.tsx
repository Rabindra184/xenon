import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Profile, SecretKey } from '@shared/types';
import { LaunchPreview } from './components/LaunchPreview';
import { ProfilesSheet } from './sheets/Profiles';
import { Home } from './screens/Home';
import { Logs } from './screens/Logs';
import { Settings, type SettingsTab } from './screens/settings/Settings';
import { Setup } from './screens/Setup';
import { AppShell } from './AppShell';
import { validate } from './validation';
import { isServerActive } from './serverStatus';
import { useReadiness } from './useReadiness';
import { sidebarBlockedReason } from './sidebarReason';
import { answerIsStale, phonesChanged } from './setupRows';
import { exportNotice } from './exportNotice';
import { runShownFor } from './setupProgress';
import { focusChosenPlaceIfLost, setupNeedsAttention, type Place } from './navigation';
import { essentialsShows, schemaDefaults } from './essentials';
import { useProfiles } from './hooks/useProfiles';
import { useLastRun, useServer, useStartFlow } from './hooks/useServer';
import { usePreferences } from './hooks/usePreferences';
import { useEffectiveSchema } from './hooks/useEffectiveSchema';
import { useCrashAlert } from './hooks/useCrashAlert';
import { usePendingFocus } from './hooks/usePendingFocus';
import { useMenuActions } from './hooks/useMenuActions';
import { useSetupRun } from './hooks/useSetupRun';
import { usePortDraft } from './hooks/usePortDraft';
import { useAutoHome } from './hooks/useAutoHome';
import { useHomeActions } from './hooks/useHomeActions';
import { PROFILES } from './copy/profiles';
import { SHELL } from './copy/shell';
import { Toaster } from './components/ui/Toaster';
import { toast } from './components/ui/toastStore';
import { Button } from './components/ui/Button';
import { EmptyState } from './components/ui/EmptyState';
import { Plus } from 'lucide-react';

export default function App() {
  const [place, setPlace] = useState<Place>('home');
  // The place on screen now, for a start that decides where to go once its check is back.
  const placeRef = useRef<Place>(place);
  placeRef.current = place;
  const crash = useCrashAlert(place);
  const profileApi = useProfiles();
  const { profiles, activeId, draft } = profileApi;
  const server = useServer({ onStatus: crash.onStatus });
  const { state: serverState, logs } = server;
  const serverStatus = serverState.status;
  // The option list and Setup's plugin version, read from the profile's Appium folder.
  const {
    schema,
    schemaFor,
    schemaInfo,
    installedPluginVersion,
    refresh: refreshInstalled
  } = useEffectiveSchema(draft, serverStatus);
  const { prefs, setPrefs } = usePreferences();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('essentials');
  // Things that can change whether Start is allowed (see useReadiness).
  const [focusTick, setFocusTick] = useState(0);
  const [recheckTick, setRecheckTick] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  // The secret values the last export left out; the sheet says so until it is closed.
  const [exportLeftOut, setExportLeftOut] = useState<string[]>([]);
  // The same, from an export that opened the sheet to say so: held until the sheet is on screen.
  const [heldLeftOut, setHeldLeftOut] = useState<string[] | null>(null);

  // The latest values, for handlers that run after an await.
  const draftRef = useRef<Profile | null>(null);
  const profilesOpenRef = useRef(false);
  const schemaRef = useRef(schema);
  draftRef.current = draft;
  profilesOpenRef.current = profilesOpen;
  schemaRef.current = schema;

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

  const updateServerField = <K extends keyof Profile['server']>(field: K, value: Profile['server'][K]) =>
    profileApi.update((p) => ({ ...p, server: { ...p.server, [field]: value } }));

  const { portText, portTextFor, portError, onPortChange, setPort } = usePortDraft(draft, (port) =>
    updateServerField('port', port)
  );
  const { autoHome, reread: rereadAutoHome } = useAutoHome(draft);

  const updateSetting = (key: string, value: unknown) =>
    profileApi.update((p) => {
      const settings = { ...p.settings };
      if (value === undefined) delete settings[key];
      else settings[key] = value;
      return { ...p, settings };
    });

  // By the id of the profile whose switch it is (R51).
  const toggleSecretRef = (profileId: string, key: SecretKey, on: boolean) =>
    profileApi.updateProfile(profileId, (p) => {
      const set = new Set(p.secretRefs);
      on ? set.add(key) : set.delete(key);
      return { ...p, secretRefs: Array.from(set) };
    });

  const updateEnv = (env: Record<string, string>) => profileApi.update((p) => ({ ...p, env }));

  const setup = useSetupRun(draft, async () => {
    await refreshInstalled();
    // Main re-detects the folder after an install; keep the card's path in step.
    // The profile on screen now, which may not be the one Set up was clicked on.
    const shown = draftRef.current;
    if (shown) await rereadAutoHome(shown);
  });
  const {
    installing,
    isInstalling,
    progress: setupProgress,
    runs: setupRuns,
    summary: setupSummary,
    run: handleInstall
  } = setup;
  // Setup shows a run's steps and how it ended only on the profile the run was for.
  const shownRun = runShownFor(
    { profileId: setup.runFor, progress: setupProgress, summary: setupSummary },
    draft?.id ?? null
  );

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

  const { readiness, checking, checkedAt, answerId, answerFor, refreshNow } = useReadiness(
    draft,
    { focus: focusTick, setup: setupRuns, recheck: recheckTick },
    serverStatus,
    installing
  );

  // The phones the open profile is for decide what the checks say (iPhone support is not needed for
  // Android alone), and nothing above looks again for them: a change to them does, as Check again
  // would. readiness.ts is Part A's and keeps its own triggers.
  const phones = draft === null ? null : { id: draft.id, platform: draft.settings.platform };
  const shownPhones = useRef<{ id: string; platform: unknown } | null>(null);
  useEffect(() => {
    if (phones !== null && phonesChanged(shownPhones.current, phones)) setRecheckTick((n) => n + 1);
    shownPhones.current = phones;
    // `phones` is rebuilt every render; its fields are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phones?.id, phones?.platform]);

  // How the open profile's server last ended, for Home's footer.
  const lastRun = useLastRun(draft?.id ?? null, serverStatus);

  // A setting Essentials shows now (the port, say) is focused there; any other (the base path) in All
  // settings, whose Technical group shows itself for a problem with technical details off.
  const focusWhenDrawn = usePendingFocus();
  const focus = useCallback(
    (path: string) => {
      const shown = draftRef.current;
      const inEssentials =
        shown !== null &&
        essentialsShows(path, shown, { defaults: schemaDefaults(schemaRef.current), hubOpen: false, secretsSaved: {} });
      setSettingsTab(inEssentials ? 'essentials' : 'all');
      focusWhenDrawn(path);
    },
    [focusWhenDrawn]
  );

  // Export saves the open profile. What the file leaves out is told on the sheet; from the menu
  // the sheet is closed, so it opens to say so. A save that fails says so, rather than nothing.
  const exportCurrentProfile = async () => {
    const current = draftRef.current;
    if (!current) return;
    try {
      const { saved, leftOut } = await profileApi.exportProfile(current.id);
      if (saved && leftOut.length > 0 && !profilesOpenRef.current) {
        setExportLeftOut([]);
        setHeldLeftOut(leftOut);
        setProfilesOpen(true);
      } else {
        setExportLeftOut(saved ? leftOut : []);
      }
    } catch (err) {
      console.error('[Xenon Control] could not export the profile:', err);
      clearExportNotice();
      toast(PROFILES.exportFailed, 'error');
    }
  };

  // The notice for an export that opened the sheet comes into the sheet's live region a frame after
  // the sheet is on screen. Arriving with the sheet, the region would already hold it, and a screen
  // reader may not say it.
  useEffect(() => {
    if (!profilesOpen || heldLeftOut === null) return;
    const frame = requestAnimationFrame(() => {
      setExportLeftOut(heldLeftOut);
      setHeldLeftOut(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [profilesOpen, heldLeftOut]);

  // Saves the Appium config Start would write, where the person chooses.
  const exportConfig = async () => {
    const current = draftRef.current;
    if (!current) return;
    try {
      if (await window.xenon.profiles.exportConfigYaml(current)) toast(SHELL.settings.configSaved);
    } catch (err) {
      console.error('[Xenon Control] could not export the config:', err);
      toast(SHELL.settings.exportConfigFailed, 'error');
    }
  };

  // The sheet's export notice is about the last export. Anything else done in the sheet, or another
  // profile opened (from anywhere), makes it old news, so it goes.
  function clearExportNotice() {
    setExportLeftOut([]);
    setHeldLeftOut(null);
  }
  useEffect(() => {
    setExportLeftOut([]);
    setHeldLeftOut(null);
  }, [activeId]);

  // A place opened from the View menu takes focus when the place it replaced had it, or nothing
  // did (see focusChosenPlaceIfLost). A place chosen in the sidebar already has it.
  const [menuPlaceTick, setMenuPlaceTick] = useState(0);
  const openPlaceFromMenu = useCallback((next: Place) => {
    setPlace(next);
    setMenuPlaceTick((n) => n + 1);
  }, []);
  useEffect(() => {
    if (menuPlaceTick > 0) focusChosenPlaceIfLost();
  }, [menuPlaceTick]);

  const start = useStartFlow({
    draft,
    issues: validationIssues,
    readiness,
    checking,
    installing,
    isInstalling,
    status: serverStatus,
    refreshNow,
    flush: profileApi.flush,
    resetLogs: server.clearLogs,
    go: setPlace,
    placeNow: () => placeRef.current,
    focus
  });
  const { requestStart } = start;
  const serverActive = isServerActive(serverStatus);

  // The lists show the open profile as edited on screen: a rename or a new port is there at once,
  // not after the save that follows typing.
  const shownProfiles = useMemo(
    () => profiles.map((p) => (draft && p.id === draft.id ? draft : p)),
    [profiles, draft]
  );

  // What Home's buttons and its quick fix do, and Copy Test Address.
  const home = useHomeActions({
    server: serverState,
    draft,
    profiles: shownProfiles,
    requestStart,
    stop: server.stop,
    refreshNow,
    runSetup: handleInstall,
    setPort,
    flush: profileApi.flush,
    select: profileApi.select,
    go: setPlace,
    focus
  });

  // The application menu and the menu-bar icon. Nothing is acted on until the
  // profiles are read. A Start, the launch preview and the config export also
  // wait until the window knows what a Start would launch: the server's status
  // is read, and the open profile's settings have been checked against its own
  // option list with its port in the box. One sent sooner (Start from the
  // menu-bar icon into a window that is just opening) waits until then, so an
  // invalid setting stops it as it stops the Start button.
  const settingsChecked = draft === null || (schema !== null && schemaFor === draft.id && portTextFor === draft.id);
  useMenuActions(
    {
      'new-profile': () => void profileApi.create(),
      'import-profiles': () => void profileApi.importProfiles(),
      'export-profile': () => void exportCurrentProfile(),
      'manage-profiles': () => setProfilesOpen(true),
      'launch-preview': () => setPreviewOpen(true),
      'export-config': () => void exportConfig(),
      'toggle-server': () => void (serverActive ? server.stop() : requestStart()),
      // Only ever a start: while the server is active, requestStart does nothing.
      'start-server': () => void requestStart(),
      'copy-test-address': () => void home.copyTestAddress()
    },
    openPlaceFromMenu,
    {
      profiles: profileApi.loaded,
      server: profileApi.loaded && server.loaded,
      settings: profileApi.loaded && server.loaded && settingsChecked
    }
  );

  // Setup's Check again. It bumps the recheck tick, which useReadiness waits out and looks after
  // (as every other reason to look does). While the server is active that tick looks at nothing (it
  // holds the port), so the press looks itself: main leaves our own server's port out of it.
  const checkAgain = () => {
    setRecheckTick((n) => n + 1);
    if (serverActive) void refreshNow();
  };

  // Setup with nothing to show: the window was opened while the server ran, so no check has run
  // since (none does while it is active). Look once, so Setup is not left saying "Checking…".
  const nothingChecked = readiness === null;
  useEffect(() => {
    if (place === 'setup' && nothingChecked && serverActive && !installing) void refreshNow();
  }, [place, nothingChecked, serverActive, installing, refreshNow]);
  // The same for an Appium folder or port changed while the server is active: Setup shows what depends
  // on the folder as checking until an answer for it is back, and none would come. A change made while
  // that look is out is looked at once it is back.
  const answerStale = draft !== null && answerIsStale(answerFor, draft);
  useEffect(() => {
    if (place === 'setup' && answerStale && serverActive && !installing && !checking) void refreshNow();
  }, [place, answerStale, serverActive, installing, checking, refreshNow]);

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
        view={place === 'settings' ? settingsTab : undefined}
        sidebar={{
          switcher: switcherReady
            ? {
                profiles: shownProfiles,
                activeId,
                server: serverState,
                onSelect: profileApi.select,
                onNew: () => void profileApi.create(),
                onManage: () => setProfilesOpen(true)
              }
            : null,
          setupAttention: setupNeedsAttention(readiness, installing, draft, installedPluginVersion, answerFor),
          logsAlert: crash.logsAlert,
          status: {
            state: serverState,
            busy: start.busy || server.stopPending,
            // Part A's reason, in the plain words Home and Setup use for Node.js and Appium (R24).
            blockedReason: sidebarBlockedReason(start.decision, readiness, prefs.technicalDetails),
            startError: start.startError,
            onStart: requestStart,
            onStop: server.stop,
            onShowHome: () => setPlace('home'),
            place
          }
        }}
        places={{
          home: draft ? (
            <Home
              server={serverState}
              profile={draft}
              profiles={shownProfiles}
              readiness={readiness}
              checking={checking}
              installing={installing}
              issues={validationIssues}
              lastRun={lastRun}
              setupProgress={setupProgress}
              technicalDetails={prefs.technicalDetails}
              startBusy={start.busy}
              stopBusy={server.stopPending}
              onAction={home.onAction}
              onQuickFix={home.onQuickFix}
            />
          ) : (
            noProfile
          ),
          setup: draft ? (
            <Setup
              profile={draft}
              readiness={readiness}
              checking={checking}
              checkedAt={checkedAt}
              answerId={answerId}
              answerFor={answerFor}
              installedVersion={installedPluginVersion}
              appiumFolder={autoHome}
              technicalDetails={prefs.technicalDetails}
              installing={installing}
              serverActive={serverActive}
              progress={shownRun.progress}
              setupSummary={shownRun.summary}
              onSetUp={handleInstall}
              onCheckAgain={checkAgain}
            />
          ) : (
            noProfile
          ),
          settings: draft ? (
            <Settings
              // Another profile draws Settings afresh: every editor that keeps text of its own (a number
              // being typed, a table cell, a JSON box, the search box) would otherwise show the old
              // profile's and write it into the new one when focus leaves (Task 14).
              key={draft.id}
              profile={draft}
              tab={settingsTab}
              onTab={setSettingsTab}
              issues={validationIssues}
              portText={portText}
              onPortChange={onPortChange}
              schema={schema}
              schemaInfo={schemaInfo}
              update={profileApi.update}
              updateProfile={profileApi.updateProfile}
              onSetting={updateSetting}
              autoHome={autoHome}
              onServerField={updateServerField}
              onPreview={() => setPreviewOpen(true)}
              onExportConfig={() => void exportConfig()}
              server={serverState}
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
          if (!open) clearExportNotice();
        }}
        profiles={shownProfiles}
        activeId={activeId}
        server={serverState}
        onRename={(id, name) => {
          clearExportNotice();
          profileApi.rename(id, name);
        }}
        onDuplicate={(id) => {
          clearExportNotice();
          void profileApi.duplicate(id);
        }}
        onDelete={(id) => {
          clearExportNotice();
          void profileApi.remove(id);
        }}
        onNew={() => {
          clearExportNotice();
          void profileApi.create();
        }}
        onImport={() => {
          clearExportNotice();
          void profileApi.importProfiles();
        }}
        onExport={() => void exportCurrentProfile()}
        notice={exportNotice(exportLeftOut, prefs.technicalDetails)}
      />
      {previewOpen && draft && <LaunchPreview profile={draft} onClose={() => setPreviewOpen(false)} />}
      <Toaster />
    </>
  );
}
