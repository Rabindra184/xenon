import type { PreflightResult, ServerState } from '@shared/types';
import { Eye, ExternalLink, Loader2, Play, Square } from 'lucide-react';
import { cn } from '../cn';
import { Button } from './ui/Button';

interface Props {
  state: ServerState;
  preflight: PreflightResult | null;
  busy: boolean;
  /** Count of blocking validation issues; > 0 disables Start. */
  invalidCount: number;
  onStart: () => void;
  onStop: () => void;
  onPreview: () => void;
}

const STATUS_META: Record<ServerState['status'], { label: string; dot: string }> = {
  stopped: { label: 'Stopped', dot: 'bg-dim' },
  starting: { label: 'Starting…', dot: 'bg-warn animate-pulse' },
  running: { label: 'Running', dot: 'bg-accent' },
  stopping: { label: 'Stopping…', dot: 'bg-warn animate-pulse' },
  crashed: { label: 'Crashed', dot: 'bg-danger' }
};

export function StatusBar({ state, preflight, busy, invalidCount, onStart, onStop, onPreview }: Props) {
  const meta = STATUS_META[state.status];
  const active = state.status === 'running' || state.status === 'starting' || state.status === 'stopping';
  const blocked = (preflight ? !preflight.ok : false) || invalidCount > 0;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-2.5">
      <div className="flex items-center gap-2 text-sm">
        <span className={cn('h-2.5 w-2.5 rounded-full', meta.dot)} />
        <span className="font-medium">{meta.label}</span>
        {state.port && active && <span className="font-mono text-muted">:{state.port}</span>}
        {state.lastError && state.status === 'crashed' && (
          <span className="max-w-md truncate text-xs text-danger" title={state.lastError}>
            {state.lastError}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {invalidCount > 0 && !active && (
          <span className="text-xs font-medium text-danger">
            {invalidCount} validation {invalidCount === 1 ? 'issue' : 'issues'}
          </span>
        )}
        {!active && (
          <Button data-testid="preview-button" onClick={onPreview} icon={<Eye size={14} />}>
            Preview
          </Button>
        )}
        {state.status === 'running' && state.dashboardUrl && (
          <Button
            onClick={() => window.xenon.server.openDashboard(state.dashboardUrl!)}
            icon={<ExternalLink size={14} />}
          >
            Dashboard
          </Button>
        )}
        {active ? (
          <Button
            data-testid="stop-button"
            variant="danger"
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
            onClick={onStart}
            disabled={busy || blocked}
            title={blocked ? 'Resolve preflight blockers first' : undefined}
            icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          >
            Start
          </Button>
        )}
      </div>
    </div>
  );
}
