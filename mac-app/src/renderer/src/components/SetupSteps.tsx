import type { SetupProgress } from '@shared/types';
import { AlertTriangle, CheckCircle2, Loader2, XCircle, type LucideIcon } from 'lucide-react';
import { SETUP } from '../copy/setup';
import { rowDetail, rowState, stepLabel, type RowState } from '../setupProgress';

const STEP_MARK: Record<RowState, { Icon: LucideIcon; className: string }> = {
  running: { Icon: Loader2, className: 'animate-spin text-muted' },
  ok: { Icon: CheckCircle2, className: 'text-ok' },
  note: { Icon: AlertTriangle, className: 'text-warn' },
  failed: { Icon: XCircle, className: 'text-danger' }
};

/**
 * Set up's steps (A3's rows), on Home while it runs and on Setup under its
 * button: a mark named for a screen reader, the step in plain words, a note in
 * plain words, and a failed step's error quoted as it is (mono, data-raw). The
 * list grows with the page rather than scrolling on its own, so every step can
 * be reached without a scroll area of its own to focus.
 */
export function SetupSteps({ rows }: { rows: SetupProgress[] }) {
  const words = SETUP.steps;
  return (
    <ul
      aria-label={words.label}
      data-testid="setup-steps"
      className="space-y-1.5 rounded-lg border border-line bg-surface px-4 py-3"
    >
      {rows.map((row) => {
        const state = rowState(row);
        const detail = rowDetail(row);
        const { Icon, className } = STEP_MARK[state];
        return (
          <li key={row.step} className="text-sm">
            <div className="flex items-center gap-2">
              <span role="img" aria-label={words.state[state]} className="shrink-0">
                <Icon size={14} aria-hidden="true" className={className} />
              </span>
              <span className="text-ink">{stepLabel(row.step)}</span>
            </div>
            {detail && state === 'failed' && (
              <p data-raw className="ml-6 break-words font-mono text-2xs text-muted">
                {detail}
              </p>
            )}
            {detail && state === 'note' && <p className="ml-6 text-xs text-muted">{detail}</p>}
          </li>
        );
      })}
    </ul>
  );
}
