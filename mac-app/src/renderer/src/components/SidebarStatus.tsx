import type { ServerState } from '@shared/types';
import { Circle, Loader2, Play, Square } from 'lucide-react';
import { cn } from '../cn';
import { SHELL } from '../copy/shell';
import { STATUS_DOT, STATUS_WORD, isServerActive, startErrorToShow } from '../serverStatus';
import { Button } from './ui/Button';

export interface SidebarStatusProps {
  state: ServerState;
  /** A start or a stop is under way. */
  busy: boolean;
  /** Why Start is off, in words; null when it is on. Shown under Start and as its tooltip. */
  blockedReason: string | null;
  /** Why the last start failed; shown until the next start. */
  startError: string | null;
  onStart: () => void;
  onStop: () => void;
  /** The status word goes Home, where the whole story is. */
  onShowHome: () => void;
}

/**
 * The bottom of the sidebar: the server's status as a dot and a word, and the
 * one Start or Stop. It sits on the sidebar's own surface, never on surface2:
 * the danger text is under 4.5:1 there in dark.
 */
export function SidebarStatus({ state, busy, blockedReason, startError, onStart, onStop, onShowHome }: SidebarStatusProps) {
  const active = isServerActive(state.status);
  // A failed start is also the crashed server's lastError, which Home shows; say it once.
  const shownStartError = startErrorToShow(startError, state);
  const word = STATUS_WORD[state.status];

  return (
    <div data-testid="sidebar-status" className="flex shrink-0 flex-col gap-2 border-t border-line p-3">
      <button
        type="button"
        onClick={onShowHome}
        title={SHELL.status.showHome}
        className="focus-ring -mx-1 flex items-center gap-2 rounded-md px-1 py-1 text-left text-sm font-medium text-ink hover:bg-surface2"
      >
        <Circle size={14} aria-hidden="true" className={cn('shrink-0 fill-current', STATUS_DOT[state.status])} />
        <span className="min-w-0">{word}</span>
      </button>
      {/* Present from the first frame, so a change of status is announced (politely). */}
      <div role="status" aria-live="polite" className="sr-only">
        {word}
      </div>
      {active ? (
        <Button
          data-testid="stop-button"
          variant="danger"
          className="w-full"
          onClick={onStop}
          disabled={busy || state.status === 'stopping'}
          icon={
            state.status === 'stopping' ? (
              <Loader2 size={14} aria-hidden="true" className="animate-spin" />
            ) : (
              <Square size={14} aria-hidden="true" />
            )
          }
        >
          {SHELL.status.stop}
        </Button>
      ) : (
        <Button
          data-testid="start-button"
          variant="primary"
          className="w-full"
          onClick={onStart}
          disabled={busy || blockedReason !== null}
          title={blockedReason ?? undefined}
          icon={
            busy ? (
              <Loader2 size={14} aria-hidden="true" className="animate-spin" />
            ) : (
              <Play size={14} aria-hidden="true" />
            )
          }
        >
          {SHELL.status.start}
        </Button>
      )}
      {blockedReason && !active && (
        <p data-testid="start-blocked-reason" className="text-xs text-muted">
          {blockedReason}
        </p>
      )}
      {shownStartError && (
        <p data-testid="start-error" className="break-words text-xs text-danger">
          {shownStartError}
        </p>
      )}
    </div>
  );
}
