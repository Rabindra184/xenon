import type { ServerState } from '@shared/types';
import { Eye, Loader2, Play, Square } from 'lucide-react';
import { cn } from '../cn';
import { STATUS_DOT, statusBarLabel } from '../serverStatus';
import { Button } from './ui/Button';

interface Props {
  state: ServerState;
  busy: boolean;
  /** Why Start is off, in words; null when it is on. Shown beside Start and as its tooltip. */
  blockedReason: string | null;
  /** Why the last start failed; shown until the next start. */
  startError: string | null;
  onStart: () => void;
  onStop: () => void;
  onPreview: () => void;
}

export function StatusBar({ state, busy, blockedReason, startError, onStart, onStop, onPreview }: Props) {
  const active = state.status === 'running' || state.status === 'starting' || state.status === 'stopping';

  return (
    <div className="flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className={cn('h-2.5 w-2.5 rounded-full', STATUS_DOT[state.status])} />
        <span className="font-medium">{statusBarLabel(state.status)}</span>
        {state.port && active && <span className="font-mono text-muted">:{state.port}</span>}
        {state.status === 'running' && state.dashboardUrl && (
          <button
            onClick={() => window.xenon.server.openDashboard(state.dashboardUrl!)}
            title="Open the Xenon dashboard in your browser"
            className="focus-ring rounded font-mono text-xs text-accent hover:underline"
          >
            {state.dashboardUrl}
          </button>
        )}
        {state.lastError && state.status === 'crashed' && (
          <span className="max-w-md truncate text-xs text-danger" title={state.lastError}>
            {state.lastError}
          </span>
        )}
        {startError && !active && (
          <span data-testid="start-error" className="max-w-md truncate text-xs text-danger" title={startError}>
            {startError}
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2">
        {blockedReason && !active && (
          <span data-testid="start-blocked-reason" className="min-w-0 truncate text-xs text-muted" title={blockedReason}>
            {blockedReason}
          </span>
        )}
        {!active && (
          <Button data-testid="preview-button" className="shrink-0" onClick={onPreview} icon={<Eye size={14} />}>
            Preview
          </Button>
        )}
        {active ? (
          <Button
            data-testid="stop-button"
            variant="danger"
            className="shrink-0"
            onClick={onStop}
            disabled={busy || state.status === 'stopping'}
            icon={state.status === 'stopping' ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
          >
            Stop
          </Button>
        ) : (
          <Button
            data-testid="start-button"
            variant="primary"
            className="shrink-0"
            onClick={onStart}
            disabled={busy || blockedReason !== null}
            title={blockedReason ?? undefined}
            icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          >
            Start
          </Button>
        )}
      </div>
    </div>
  );
}
