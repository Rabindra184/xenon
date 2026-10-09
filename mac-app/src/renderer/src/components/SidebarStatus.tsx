import { useId } from 'react';
import type { ServerState } from '@shared/types';
import { Circle, Loader2, Play, Square } from 'lucide-react';
import { cn } from '../cn';
import { SHELL } from '../copy/shell';
import { STATUS_DOT, STATUS_WORD, isServerActive, startErrorToShow } from '../serverStatus';
import { Button } from './ui/Button';
import type { Place } from '../navigation';

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
  /** The place on screen: on Home, a failed start that Home already tells is not said again here. */
  place: Place;
}

/**
 * The bottom of the sidebar: the server's status as a dot and a word, and the
 * one Start or Stop. It sits on the sidebar's own surface, never on surface2:
 * the danger text is under 4.5:1 there in dark.
 *
 * Start and Stop are one button, which reads Start or Stop as the server
 * needs, so focus stays on it as one becomes the other. It is never disabled:
 * a button that becomes disabled drops focus, to nowhere, and a keyboard or
 * VoiceOver user loses their place (a start's own check can block Start a
 * moment after it was pressed, and a stop can leave Start checking). While a
 * start or a stop is under way, or Start is blocked, it says it can't be
 * pressed (aria-disabled) and ignores presses. A blocked Start is described by
 * its reason, which shows below it in a live region that is on the page from
 * the first frame, so a reason that comes after a press is announced.
 */
export function SidebarStatus({
  state,
  busy,
  blockedReason,
  startError,
  onStart,
  onStop,
  onShowHome,
  place
}: SidebarStatusProps) {
  const active = isServerActive(state.status);
  const stopping = state.status === 'stopping';
  const waiting = busy || stopping;
  // A failed start is also the crashed server's lastError, which Home tells while it is open; say it once there.
  const shownStartError = startErrorToShow(startError, state, place);
  const word = STATUS_WORD[state.status];
  const showsReason = blockedReason !== null && !active;
  const blocked = showsReason && !waiting;
  const unavailable = waiting || blocked;
  const reasonId = useId();

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
      <div>
        {/* Its colour is what it does, so it changes at once: a cross-fade shows Start on red, or Stop on green. */}
        <Button
          data-testid={active ? 'stop-button' : 'start-button'}
          variant={active ? 'danger' : 'primary'}
          className="w-full transition-none"
          onClick={() => {
            if (unavailable) return;
            if (active) onStop();
            else onStart();
          }}
          aria-disabled={unavailable || undefined}
          aria-describedby={showsReason ? reasonId : undefined}
          title={blocked ? (blockedReason ?? undefined) : undefined}
          icon={
            (active ? stopping : busy) ? (
              <Loader2 size={14} aria-hidden="true" className="animate-spin" />
            ) : active ? (
              <Square size={14} aria-hidden="true" />
            ) : (
              <Play size={14} aria-hidden="true" />
            )
          }
        >
          {active ? SHELL.status.stop : SHELL.status.start}
        </Button>
        {/* Empty until Start is blocked. No role: the status word's region is the sidebar's status. */}
        <div aria-live="polite">
          {showsReason && (
            <p id={reasonId} data-testid="start-blocked-reason" className="mt-2 text-xs text-muted">
              {blockedReason}
            </p>
          )}
        </div>
      </div>
      {shownStartError && (
        <p data-testid="start-error" className="break-words text-xs text-danger">
          {shownStartError}
        </p>
      )}
    </div>
  );
}
