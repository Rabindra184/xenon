import { useEffect, useState } from 'react';
import type { ToolCheck } from '@shared/types';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { Button } from './ui/Button';

interface Props {
  onInstall: () => void;
  installing: boolean;
}

function StatusIcon({ status }: { status: ToolCheck['status'] }) {
  if (status === 'ok') return <CheckCircle2 size={16} className="text-accent" />;
  if (status === 'warn') return <AlertTriangle size={16} className="text-warn" />;
  if (status === 'checking') return <Loader2 size={16} className="animate-spin text-dim" />;
  return <XCircle size={16} className="text-danger" />;
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
          onClick={onInstall}
          disabled={installing}
          icon={installing ? <Loader2 size={14} className="animate-spin" /> : undefined}
        >
          {installing ? 'Installing…' : 'Install plugin + drivers'}
        </Button>
      </div>
    </div>
  );
}
