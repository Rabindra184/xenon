import { useEffect, useState, type ReactNode } from 'react';
import type { ServerState } from '@shared/types';
import { ExternalLink } from 'lucide-react';
import { SHELL } from '../copy/shell';
import { STATUS_HINT, STATUS_WORD, formatUptime } from '../serverStatus';
import { Button } from '../components/ui/Button';

interface Props {
  state: ServerState;
  /** Why Start is off, when it is (ReadinessBlockers), or null. */
  blockers: ReactNode;
}

/**
 * Home, until its own screen (B3): the status, what to do while running or
 * after a crash, and why Start is off.
 */
export function Home({ state, blockers }: Props) {
  const status = state.status;

  // 1s uptime ticker, only while the server is running and Home is open.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">{STATUS_WORD[status]}</h1>
        {STATUS_HINT[status] && <p className="mt-1 text-sm text-muted">{STATUS_HINT[status]}</p>}
        {status === 'running' && state.port != null && state.startedAt && (
          <p className="mt-1 text-sm text-muted">{SHELL.home.runningOn(state.port, formatUptime(now - state.startedAt))}</p>
        )}
      </div>
      {status === 'running' && state.dashboardUrl && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={() => window.xenon.server.openDashboard(state.dashboardUrl!)}
            icon={<ExternalLink size={14} aria-hidden="true" />}
          >
            {SHELL.home.openDashboard}
          </Button>
          <span className="font-mono text-xs text-muted">{state.dashboardUrl}</span>
        </div>
      )}
      {status === 'crashed' && state.lastError && (
        <div>
          <p className="text-sm font-medium text-ink">{SHELL.home.lastMessage}</p>
          <p data-raw className="mt-1 break-words font-mono text-xs text-muted">
            {state.lastError}
          </p>
        </div>
      )}
      {blockers}
    </div>
  );
}
