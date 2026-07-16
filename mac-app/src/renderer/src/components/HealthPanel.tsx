import { useEffect, useRef, useState } from 'react';
import type { Profile, SetupProgress, ToolCheck } from '@shared/types';
import { cn } from '../cn';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { Button } from './ui/Button';

interface Props {
  onInstall: () => void;
  installing: boolean;
  /** Drives the checks whose verdict depends on profile settings (WDA ports). */
  profile: Profile | null;
}

function StatusIcon({ status }: { status: ToolCheck['status'] }) {
  if (status === 'ok') return <CheckCircle2 size={16} className="text-accent" />;
  if (status === 'warn') return <AlertTriangle size={16} className="text-warn" />;
  if (status === 'checking') return <Loader2 size={16} className="animate-spin text-dim" />;
  return <XCircle size={16} className="text-danger" />;
}

const CHIP: Record<ToolCheck['status'], string> = {
  ok: 'bg-accent/10 text-accent border-accent/30',
  warn: 'bg-warn/10 text-warn border-warn/30',
  checking: 'bg-surface2 text-dim border-line',
  missing: 'bg-danger/10 text-danger border-danger/30'
};

export function HealthPanel({ onInstall, installing, profile }: Props) {
  const [checks, setChecks] = useState<ToolCheck[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<SetupProgress[]>([]);

  const refresh = async () => {
    setLoading(true);
    try {
      setChecks(await window.xenon.toolchain.check(profileRef.current ?? undefined));
    } finally {
      setLoading(false);
    }
  };

  // Re-check when the settings the verdicts depend on change, without
  // re-running on every unrelated keystroke.
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const settingsKey = JSON.stringify([
    profile?.settings.platform,
    profile?.settings.bootedSimulators,
    (profile?.settings.simulators as unknown[] | undefined)?.length ?? 0
  ]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  // Live install progress from the main process.
  useEffect(() => window.xenon.onSetupProgress((p) => setProgress((prev) => [...prev, p])), []);

  const install = () => {
    setProgress([]);
    onInstall();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          Host toolchain Xenon depends on. Blocking items must be resolved before a server can start.
        </p>
        <Button size="sm" onClick={refresh} icon={<RefreshCw size={13} className={loading ? 'animate-spin' : ''} />}>
          Re-check
        </Button>
      </div>

      <div className="divide-y divide-line rounded-lg border border-line bg-surface">
        {checks.map((c) => (
          <div key={c.id} className="flex items-start gap-3 p-3">
            <StatusIcon status={c.status} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{c.label}</span>
                <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', CHIP[c.status])}>
                  {c.status}
                </span>
                {c.blocking && c.status !== 'ok' && (
                  <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-medium text-danger">
                    blocking
                  </span>
                )}
              </div>
              <p className="text-xs text-muted">{c.detail}</p>
              {c.remediation && c.status !== 'ok' && (
                <p className="mt-1 text-xs text-ink">→ {c.remediation}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-line bg-surface p-3">
        <h4 className="text-sm font-medium">First-run setup</h4>
        <p className="mt-1 text-xs text-muted">
          Install the Xenon plugin and platform drivers into this profile's APPIUM_HOME.
        </p>
        <Button
          variant="primary"
          className="mt-2"
          onClick={install}
          disabled={installing}
          icon={installing ? <Loader2 size={14} className="animate-spin" /> : undefined}
        >
          {installing ? 'Installing…' : 'Install plugin + drivers'}
        </Button>
        {progress.length > 0 && (
          <div className="mt-3 max-h-40 overflow-auto rounded-md border border-line bg-app p-2 font-mono text-[11px]">
            {progress.map((p, i) => (
              <div key={i} className={cn('flex gap-2', p.done && !p.ok ? 'text-danger' : 'text-muted')}>
                <span className={p.done ? (p.ok ? 'text-accent' : 'text-danger') : 'text-dim'}>
                  {p.done ? (p.ok ? '✓' : '✗') : '…'}
                </span>
                <span className="text-ink">{p.step}</span>
                <span className="truncate">{p.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
