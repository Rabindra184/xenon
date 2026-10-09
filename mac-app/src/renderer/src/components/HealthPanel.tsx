import { useEffect, useRef, useState } from 'react';
import type { Profile, SetupProgress, ToolCheck } from '@shared/types';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { Badge, type BadgeTone } from './ui/Badge';
import { Button } from './ui/Button';
import { rowDetail, rowState, stepLabel, type RowState } from '../setupProgress';
import { SHELL } from '../copy/shell';

interface Props {
  onInstall: () => void;
  installing: boolean;
  /** True while the server is starting, running or stopping; setup replaces files a live server uses. */
  serverActive: boolean;
  /** Rows for the current or last setup run; owned by App so they survive tab switches. */
  progress: SetupProgress[];
  /** Bumped by App each time a setup run ends, so the checks reflect what the run changed. */
  setupRuns: number;
  /** Drives the checks whose verdict depends on profile settings (iPhone support). */
  profile: Profile | null;
  /** The Appium folder this profile uses, shown with `~`, so setup names where it installs. */
  appiumHomeDisplay?: string;
  /** Check again pressed: whether Start is allowed is looked at again too, not just the rows below. */
  onRecheck: () => void;
}

function StatusIcon({ status }: { status: ToolCheck['status'] }) {
  if (status === 'ok') return <CheckCircle2 size={16} className="text-accent" />;
  if (status === 'warn') return <AlertTriangle size={16} className="text-warn" />;
  if (status === 'checking') return <Loader2 size={16} className="animate-spin text-dim" />;
  return <XCircle size={16} className="text-danger" />;
}

// The chip words are in the text colour (Badge); the tint and border carry the
// tone. Warning text on its tint is 4.4:1 in light, danger 4.3:1 in dark.
const CHIP: Record<ToolCheck['status'], BadgeTone> = {
  ok: 'ok',
  warn: 'attention',
  checking: 'neutral',
  missing: 'danger'
};

const ROW_MARK: Record<RowState, { glyph: string; className: string }> = {
  running: { glyph: '…', className: 'text-dim' },
  ok: { glyph: '✓', className: 'text-accent' },
  note: { glyph: '⚠', className: 'text-warn' },
  failed: { glyph: '✗', className: 'text-danger' }
};

const SERVER_ACTIVE_HINT = 'Stop the server to run Set up.';

export function HealthPanel({
  onInstall,
  installing,
  serverActive,
  progress,
  setupRuns,
  profile,
  appiumHomeDisplay,
  onRecheck
}: Props) {
  const [checks, setChecks] = useState<ToolCheck[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      setChecks(await window.xenon.toolchain.check(profileRef.current ?? undefined));
    } finally {
      setLoading(false);
    }
  };

  // Re-check when the settings the verdicts depend on change, without
  // re-running on every unrelated keystroke, and when a setup run ends (the
  // iPhone row would otherwise keep saying "not installed" until a manual Check again).
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const settingsKey = profile?.settings.platform;

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey, setupRuns]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          Host toolchain Xenon depends on. Blocking items must be resolved before a server can start.
        </p>
        <Button
          size="sm"
          onClick={() => {
            void refresh();
            onRecheck();
          }}
          icon={<RefreshCw size={14} aria-hidden="true" className={loading ? 'animate-spin' : ''} />}
        >
          {SHELL.setup.checkAgain}
        </Button>
      </div>

      <div className="divide-y divide-line rounded-lg border border-line bg-surface">
        {checks.map((c) => (
          <div key={c.id} className="flex items-start gap-3 p-3">
            <StatusIcon status={c.status} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{c.label}</span>
                <Badge tone={CHIP[c.status]}>{c.status}</Badge>
                {c.blocking && c.status !== 'ok' && <Badge tone="danger">blocking</Badge>}
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
          Installs into the Appium folder this profile uses{appiumHomeDisplay ? `: ${appiumHomeDisplay}.` : '.'}
        </p>
        <Button
          variant="primary"
          className="mt-2"
          onClick={onInstall}
          disabled={installing || serverActive}
          title={serverActive ? SERVER_ACTIVE_HINT : undefined}
          icon={installing ? <Loader2 size={14} className="animate-spin" /> : undefined}
        >
          {installing ? 'Setting up…' : 'Set up'}
        </Button>
        {serverActive && <p className="mt-1 text-xs text-muted">{SERVER_ACTIVE_HINT}</p>}
        {progress.length > 0 && (
          <div className="mt-3 max-h-40 space-y-1 overflow-auto rounded-md border border-line bg-app p-2 text-xs">
            {progress.map((p) => {
              const state = rowState(p);
              const detail = rowDetail(p);
              const mark = ROW_MARK[state];
              return (
                <div key={p.step}>
                  <div className="flex gap-2">
                    <span className={mark.className}>{mark.glyph}</span>
                    <span className={state === 'failed' ? 'text-danger' : 'text-ink'}>{stepLabel(p.step)}</span>
                  </div>
                  {detail && state === 'failed' && (
                    <p className="ml-5 truncate font-mono text-2xs text-muted" title={detail}>
                      {detail}
                    </p>
                  )}
                  {detail && state === 'note' && <p className="ml-5 text-2xs text-warn">{detail}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
