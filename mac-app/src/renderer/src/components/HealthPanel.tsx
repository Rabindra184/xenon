import { useEffect, useState } from 'react';
import type { ToolCheck } from '@shared/types';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';

interface Props {
  onInstall: () => void;
  installing: boolean;
}

function StatusIcon({ status }: { status: ToolCheck['status'] }) {
  if (status === 'ok') return <CheckCircle2 size={16} className="text-emerald-500" />;
  if (status === 'warn') return <AlertTriangle size={16} className="text-amber-500" />;
  if (status === 'checking') return <Loader2 size={16} className="animate-spin text-slate-400" />;
  return <XCircle size={16} className="text-rose-500" />;
}

export function HealthPanel({ onInstall, installing }: Props) {
  const [checks, setChecks] = useState<ToolCheck[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      setChecks(await window.xenon.toolchain.check());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Host toolchain Xenon depends on. Blocking items must be resolved before a server can start.
        </p>
        <button
          onClick={refresh}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-600"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Re-check
        </button>
      </div>

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
        {checks.map((c) => (
          <div key={c.id} className="flex items-start gap-3 p-3">
            <StatusIcon status={c.status} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{c.label}</span>
                {c.blocking && c.status !== 'ok' && (
                  <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:bg-rose-950/50 dark:text-rose-300">
                    blocking
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{c.detail}</p>
              {c.remediation && c.status !== 'ok' && (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">→ {c.remediation}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <h4 className="text-sm font-medium">First-run setup</h4>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Install the Xenon plugin and platform drivers into this profile's APPIUM_HOME.
        </p>
        <button
          onClick={onInstall}
          disabled={installing}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-50"
        >
          {installing && <Loader2 size={14} className="animate-spin" />}
          {installing ? 'Installing…' : 'Install plugin + drivers'}
        </button>
      </div>
    </div>
  );
}
