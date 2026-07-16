import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
    return () => {
      offLog();
      offState();
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
    if (importedIds.length) setActiveId(importedIds[0]);
  };
  const updateEnv = (env: Record<string, string>) => {
    if (draft) persist({ ...draft, env });
  };

  const validationIssues = useMemo(() => (schema && draft ? validate(schema, draft) : []), [schema, draft]);
  const settingIssueMap = useMemo(
    () => Object.fromEntries(validationIssues.map((i) => [i.path, i.message])),
    [validationIssues]
  );

  const runningId = serverState.status !== 'stopped' && serverState.status !== 'crashed' ? serverState.profileId : null;
  const ready = schema && draft;

  const dashboardHint = useMemo(() => {
    if (!draft) return '';
    return `http://${draft.settings.bindHostOrIp || '127.0.0.1'}:${draft.server.port}/xenon/`;
  }, [draft]);

  return (
    <div className="flex h-full flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Title bar (draggable). */}
      <div className="titlebar-drag flex h-10 shrink-0 items-center justify-center border-b border-slate-200 dark:border-slate-800">
        <span className="text-xs font-semibold tracking-wide text-slate-500">Xenon Control</span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 p-3 dark:border-slate-800">
          <ProfileList
            profiles={profiles}
            activeId={activeId}
            runningId={runningId}
            onSelect={setActiveId}
            onCreate={createProfile}
            onDuplicate={duplicateProfile}
            onDelete={deleteProfile}
          />
          <div className="mt-auto pt-3 text-[10px] text-slate-400">
            schema: plugin {meta?.pluginVersion ?? '…'}
          </div>
        </aside>

        {/* Main */}
        <main className="flex min-w-0 flex-1 flex-col">
          {!ready ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
              {profiles.length === 0 ? 'Create a profile to begin.' : 'Loading…'}
            </div>
          ) : (
            <>
              {/* Profile header */}
              <div className="border-b border-slate-200 px-6 py-3 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <input
                    data-testid="profile-name"
                    value={draft.name}
                    onChange={(e) => persist({ ...draft, name: e.target.value })}
                    className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
                  />
                  <div className="titlebar-no-drag flex shrink-0 items-center gap-1">
                    <HeaderBtn onClick={() => window.xenon.profiles.export(draft.id)} icon={<Download size={14} />} label="Export" />
                    <HeaderBtn onClick={importProfiles} icon={<Upload size={14} />} label="Import" />
                    <HeaderBtn
                      onClick={() => window.xenon.server.openPath('appiumHome', draft)}
                      icon={<FolderOpen size={14} />}
                      label="APPIUM_HOME"
                    />
                    <HeaderBtn
                      onClick={() => window.xenon.server.openPath('logs')}
                      icon={<FolderOpen size={14} />}
                      label="Logs"
                    />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                  <label className="flex items-center gap-1.5">
                    Port
                    <input
                      type="number"
                      value={draft.server.port}
                      onChange={(e) => updateServerField('port', Number(e.target.value))}
                      className="w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 dark:border-slate-600 dark:bg-slate-800"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    Base path
                    <input
                      value={draft.server.basePath}
                      onChange={(e) => updateServerField('basePath', e.target.value)}
                      className="w-28 rounded border border-slate-300 bg-white px-1.5 py-0.5 dark:border-slate-600 dark:bg-slate-800"
                    />
                  </label>
                  <label className="flex flex-1 items-center gap-1.5">
                    APPIUM_HOME
                    <input
                      value={draft.server.appiumHome}
                      placeholder="(app-managed default)"
                      onChange={(e) => updateServerField('appiumHome', e.target.value)}
                      className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 dark:border-slate-600 dark:bg-slate-800"
                    />
                  </label>
                  <span className="text-slate-400">→ {dashboardHint}</span>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 border-b border-slate-200 px-6 dark:border-slate-800">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'border-b-2 px-3 py-2 text-sm',
                      tab === t.id
                        ? 'border-accent text-accent'
                        : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
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
                      <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
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
                      <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
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
      </div>

      {previewOpen && draft && <LaunchPreview profile={draft} onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}

function HeaderBtn({ onClick, icon, label }: { onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {icon}
      {label}
    </button>
  );
}
