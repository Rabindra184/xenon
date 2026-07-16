import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  LogLine,
  PreflightResult,
  Profile,
  SchemaMeta,
  SecretDescriptor,
  SecretKey,
  ServerState,
  XenonSchema
} from '@shared/types';
import { SettingsForm } from './components/SettingsForm';
import { SecretsPanel } from './components/SecretsPanel';
import { EnvVarsEditor } from './components/EnvVarsEditor';
import { HealthPanel } from './components/HealthPanel';
import { LogConsole } from './components/LogConsole';
import { ProfileList } from './components/ProfileList';
import { StatusBar } from './components/StatusBar';
import { LaunchPreview } from './components/LaunchPreview';
import { validate } from './validation';
import { cn } from './cn';
import { STATUS_DOT, STATUS_LABEL, formatUptime } from './serverStatus';
import { Toaster } from './components/ui/Toaster';
import { toast } from './components/ui/toastStore';
import { Download, FolderOpen, Upload } from 'lucide-react';

type Tab = 'settings' | 'secrets' | 'health' | 'logs';
const TABS: { id: Tab; label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'secrets', label: 'Secrets & Env' },
  { id: 'health', label: 'Health' },
  { id: 'logs', label: 'Logs' }
];

const IDLE_STATE: ServerState = {
  status: 'stopped',
  profileId: null,
  pid: null,
  port: null,
  dashboardUrl: null,
  startedAt: null,
  logFile: null,
  exitCode: null,
  exitSignal: null,
  lastError: null
};

export default function App() {
  const [schema, setSchema] = useState<XenonSchema | null>(null);
  const [meta, setMeta] = useState<SchemaMeta | null>(null);
  const [secretDescriptors, setSecretDescriptors] = useState<SecretDescriptor[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [serverState, setServerState] = useState<ServerState>(IDLE_STATE);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [tab, setTab] = useState<Tab>('settings');
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Menu actions arrive on a subscription that mounts once, so the handler
  // reads live values through refs rather than stale closure captures.
  const draftRef = useRef<Profile | null>(null);
  const stateRef = useRef<ServerState>(IDLE_STATE);
  const actionsRef = useRef<Record<string, () => void>>({});

  // Initial load + event subscriptions.
  useEffect(() => {
    (async () => {
      const s = await window.xenon.getSchema();
      setSchema(s.schema);
      setMeta(s.meta);
      setSecretDescriptors(s.secretDescriptors);
      const list = await window.xenon.profiles.list();
      setProfiles(list);
      setActiveId(list[0]?.id ?? null);
      setServerState(await window.xenon.server.state());
    })();

    const offLog = window.xenon.onLog((line) => setLogs((prev) => [...prev.slice(-4999), line]));
    const offState = window.xenon.onServerState((st) => setServerState(st));
    const offMenu = window.xenon.onMenuAction((a) => {
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
    });
    return () => {
      offLog();
      offState();
      offMenu();
    };
  }, []);

  // Sync the editable draft when the active profile changes.
  useEffect(() => {
    const p = profiles.find((x) => x.id === activeId) ?? null;
    setDraft(p ? structuredClone(p) : null);
  }, [activeId, profiles]);

  const persist = useCallback((next: Profile) => {
    setDraft(next);
    window.xenon.profiles.save(next).then((saved) => {
      setProfiles((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    });
  }, []);

  const updateSetting = (key: string, value: unknown) => {
    if (!draft) return;
    const settings = { ...draft.settings };
    if (value === undefined) delete settings[key];
    else settings[key] = value;
    persist({ ...draft, settings });
  };

  const updateServerField = <K extends keyof Profile['server']>(field: K, value: Profile['server'][K]) => {
    if (!draft) return;
    persist({ ...draft, server: { ...draft.server, [field]: value } });
  };

  const toggleSecretRef = (key: SecretKey, on: boolean) => {
    if (!draft) return;
    const set = new Set(draft.secretRefs);
    on ? set.add(key) : set.delete(key);
    persist({ ...draft, secretRefs: Array.from(set) });
  };

  const createProfile = async () => {
    const now = Date.now();
    const fresh: Profile = {
      id: crypto.randomUUID(),
      name: 'New profile',
      settings: { platform: 'both', enableDashboard: true },
      server: { port: 4723, basePath: '/wd/hub', appiumHome: '', keepAliveTimeout: 800 },
      secretRefs: [],
      env: {},
      createdAt: now,
      updatedAt: now
    };
    const saved = await window.xenon.profiles.save(fresh);
    setProfiles((prev) => [...prev, saved]);
    setActiveId(saved.id);
  };

  const duplicateProfile = async (id: string) => {
    const copy = await window.xenon.profiles.duplicate(id);
    if (copy) {
      setProfiles((prev) => [...prev, copy]);
      setActiveId(copy.id);
    }
  };

  const deleteProfile = async (id: string) => {
    const remaining = await window.xenon.profiles.delete(id);
    setProfiles(remaining);
    if (activeId === id) setActiveId(remaining[0]?.id ?? null);
  };

  const runPreflight = useCallback(async (p: Profile) => {
    const result = await window.xenon.toolchain.preflight(p);
    setPreflight(result);
    return result;
  }, []);

  const handleStart = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const result = await runPreflight(draft);
      if (!result.ok) {
        setTab('health');
        return;
      }
      setLogs([]);
      await window.xenon.server.start(draft);
    } catch (err) {
      // surfaced via server state / logs; nothing else to do here
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      await window.xenon.server.stop();
    } finally {
      setBusy(false);
    }
  };

  const handleInstall = async () => {
    if (!draft) return;
    setInstalling(true);
    try {
      await window.xenon.setup.install({
        appiumHome: draft.server.appiumHome || undefined,
        pluginSource: 'local',
        drivers: ['uiautomator2', 'xcuitest']
      });
      await runPreflight(draft);
    } finally {
      setInstalling(false);
    }
  };

  const importProfiles = async () => {
    const { profiles: list, importedIds } = await window.xenon.profiles.import();
    setProfiles(list);
    if (importedIds.length) {
      setActiveId(importedIds[0]);
      toast(`Imported ${importedIds.length} profile${importedIds.length === 1 ? '' : 's'}`);
    }
  };

  const exportProfile = async (id: string) => {
    const ok = await window.xenon.profiles.export(id);
    if (ok) toast('Profile exported');
  };
  const updateEnv = (env: Record<string, string>) => {
    if (draft) persist({ ...draft, env });
  };

  // Keep the menu-action refs pointing at the current state and handlers.
  draftRef.current = draft;
  stateRef.current = serverState;
  actionsRef.current = {
    create: () => void createProfile(),
    import: () => void importProfiles(),
    export: () => draftRef.current && void exportProfile(draftRef.current.id),
    start: () => void handleStart(),
    stop: () => void handleStop()
  };

  const validationIssues = useMemo(() => (schema && draft ? validate(schema, draft) : []), [schema, draft]);
  const settingIssueMap = useMemo(
    () => Object.fromEntries(validationIssues.map((i) => [i.path, i.message])),
    [validationIssues]
  );

  const runningId = serverState.status !== 'stopped' && serverState.status !== 'crashed' ? serverState.profileId : null;
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
              onSelect={setActiveId}
              onCreate={createProfile}
              onDuplicate={duplicateProfile}
              onDelete={deleteProfile}
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
            <div className="mt-1 text-dim">plugin {meta?.pluginVersion ?? '…'}</div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="titlebar-drag h-10 shrink-0" />
          {!ready ? (
            <div className="flex flex-1 items-center justify-center text-sm text-dim">
              {profiles.length === 0 ? 'Create a profile to begin.' : 'Loading…'}
            </div>
          ) : (
            <>
              {/* Profile header */}
              <div className="border-b border-line px-6 py-3">
                <div className="flex items-center gap-3">
                  <input
                    data-testid="profile-name"
                    value={draft.name}
                    onChange={(e) => persist({ ...draft, name: e.target.value })}
                    className="focus-ring min-w-0 flex-1 rounded bg-transparent text-lg font-semibold"
                  />
                  <div className="titlebar-no-drag flex shrink-0 items-center gap-1">
                    <HeaderBtn onClick={() => exportProfile(draft.id)} icon={<Download size={14} />} label="Export" />
                    <HeaderBtn onClick={importProfiles} icon={<Upload size={14} />} label="Import" />
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
                      type="number"
                      value={draft.server.port}
                      onChange={(e) => updateServerField('port', Number(e.target.value))}
                      className="focus-ring w-20 rounded border border-line-strong bg-surface2 px-1.5 py-0.5 text-ink"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    Base path
                    <input
                      value={draft.server.basePath}
                      onChange={(e) => updateServerField('basePath', e.target.value)}
                      className="focus-ring w-28 rounded border border-line-strong bg-surface2 px-1.5 py-0.5 text-ink"
                    />
                  </label>
                  <label className="flex flex-1 items-center gap-1.5">
                    APPIUM_HOME
                    <input
                      value={draft.server.appiumHome}
                      placeholder="(app-managed default)"
                      onChange={(e) => updateServerField('appiumHome', e.target.value)}
                      className="focus-ring min-w-0 flex-1 rounded border border-line-strong bg-surface2 px-1.5 py-0.5 text-ink"
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
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
                {tab === 'settings' && (
                  <>
                    {validationIssues.length > 0 && (
                      <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                        <strong>{validationIssues.length} validation {validationIssues.length === 1 ? 'issue' : 'issues'}:</strong>
                        <ul className="mt-1 list-disc pl-5">
                          {validationIssues.map((i, idx) => (
                            <li key={idx}>
                              {i.label}: {i.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <SettingsForm
                      schema={schema}
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
                    {preflight && !preflight.ok && (
                      <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                        <strong>Cannot start yet:</strong>
                        <ul className="mt-1 list-disc pl-5">
                          {preflight.blockers.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                          {preflight.checks
                            .filter((c) => c.blocking && c.status !== 'ok')
                            .map((c) => (
                              <li key={c.id}>
                                {c.label}: {c.remediation ?? c.detail}
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}
                    <HealthPanel onInstall={handleInstall} installing={installing} />
                  </>
                )}
                {tab === 'logs' && <LogConsole logs={logs} />}
              </div>
            </>
          )}

          <StatusBar
            state={serverState}
            preflight={runningId ? null : preflight}
            busy={busy}
            invalidCount={validationIssues.length}
            onStart={handleStart}
            onStop={handleStop}
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
