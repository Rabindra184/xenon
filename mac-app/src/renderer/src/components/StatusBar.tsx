import type { PreflightResult, ServerState } from '@shared/types';
import { Eye, ExternalLink, Loader2, Play, Square } from 'lucide-react';
import { cn } from '../cn';

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
  stopped: { label: 'Stopped', dot: 'bg-slate-400' },
  starting: { label: 'Starting…', dot: 'bg-amber-400 animate-pulse' },
  running: { label: 'Running', dot: 'bg-emerald-500' },
  stopping: { label: 'Stopping…', dot: 'bg-amber-400 animate-pulse' },
  crashed: { label: 'Crashed', dot: 'bg-rose-500' }
};

export function StatusBar({ state, preflight, busy, invalidCount, onStart, onStop, onPreview }: Props) {
  const meta = STATUS_META[state.status];
  const active = state.status === 'running' || state.status === 'starting' || state.status === 'stopping';
  const blocked = (preflight ? !preflight.ok : false) || invalidCount > 0;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-center gap-2 text-sm">
        <span className={cn('h-2.5 w-2.5 rounded-full', meta.dot)} />
        <span className="font-medium">{meta.label}</span>
        {state.port && active && <span className="text-slate-500">:{state.port}</span>}
        {state.lastError && state.status === 'crashed' && (
          <span className="max-w-md truncate text-xs text-rose-500" title={state.lastError}>
            {state.lastError}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {invalidCount > 0 && !active && (
          <span className="text-xs font-medium text-rose-500">
            {invalidCount} validation {invalidCount === 1 ? 'issue' : 'issues'}
          </span>
        )}
        {!active && (
          <button
            data-testid="preview-button"
            onClick={onPreview}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm dark:border-slate-600"
          >
            <Eye size={14} /> Preview
          </button>
        )}
        {state.status === 'running' && state.dashboardUrl && (
          <button
            onClick={() => window.xenon.server.openDashboard(state.dashboardUrl!)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm dark:border-slate-600"
          >
            <ExternalLink size={14} /> Dashboard
          </button>
        )}
        {active ? (
          <button
            data-testid="stop-button"
            onClick={onStop}
            disabled={busy || state.status === 'stopping'}
            className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {state.status === 'stopping' ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />} Stop
          </button>
        ) : (
          <button
            data-testid="start-button"
            onClick={onStart}
            disabled={busy || blocked}
            title={blocked ? 'Resolve preflight blockers first' : undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Start
          </button>
        )}
      </div>
    </div>
  );
}
