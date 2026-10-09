import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, type LucideIcon } from 'lucide-react';
import { cn } from '../../cn';
import { UI_COPY } from '../../copy/ui';

export type StatusTone = 'ok' | 'attention' | 'info' | 'checking';

// Every tone has its own shape and its own word, so no status leans on colour alone.
const TONES: Record<StatusTone, { Icon: LucideIcon; color: string; spin?: boolean }> = {
  ok: { Icon: CheckCircle2, color: 'text-ok' },
  attention: { Icon: AlertTriangle, color: 'text-warn' },
  info: { Icon: Info, color: 'text-info' },
  checking: { Icon: Loader2, color: 'text-muted', spin: true }
};

/**
 * One status: an icon, one plain sentence, an optional action on the right, and
 * technical detail (in the mono face) that only shows when `showTechnical` is on.
 * The icon is named for a screen reader ("Ready", "Needs attention", "Note",
 * "Checking").
 *
 * A row is not a live region of its own: a screen that updates many rows at
 * once (a re-check) would make one announcement per row. The screen keeps one
 * polite region and says a short summary there instead.
 *
 * `sentenceId` names the sentence, so an action can be described by it (an
 * action's name alone, "Set up this Mac", does not say which row it is on).
 * `focusableSentence` lets the screen move focus to the sentence (it is not
 * in the tab order), for when the row's own action goes with the change it
 * made: the sentence then says the row's new state.
 */
export function StatusRow({
  tone,
  sentence,
  action,
  technical,
  showTechnical,
  testId,
  sentenceId,
  sentenceTestId,
  focusableSentence = false
}: {
  tone: StatusTone;
  sentence: string;
  action?: ReactNode;
  technical?: ReactNode;
  showTechnical: boolean;
  testId?: string;
  sentenceId?: string;
  sentenceTestId?: string;
  focusableSentence?: boolean;
}) {
  const { Icon, color, spin } = TONES[tone];
  return (
    <div data-testid={testId} data-tone={tone} className="flex min-h-8 items-start gap-3 py-1.5">
      <span role="img" aria-label={UI_COPY.status[tone]} className="mt-0.5 shrink-0">
        <Icon size={16} aria-hidden="true" className={cn(color, spin && 'animate-spin')} />
      </span>
      <div className="min-w-0 flex-1">
        <p
          id={sentenceId}
          data-testid={sentenceTestId}
          className={cn('text-sm text-ink', focusableSentence && 'focus-ring rounded-sm')}
          {...(focusableSentence ? { tabIndex: -1, 'data-row-sentence': '' } : {})}
        >
          {sentence}
        </p>
        {showTechnical && technical && (
          <div data-raw className="mt-0.5 break-words font-mono text-2xs text-muted">
            {technical}
          </div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
