import React from 'react';
import { CheckCircle2, XCircle, Loader2, CircleDashed, type LucideIcon } from 'lucide-react';
import type { ISession } from '../../interfaces/ISession';
import {
  compactDuration,
  deviceNameOrFallback,
  formatMonthDayTime,
  platformLabel,
  ranOnLabel,
  sessionDisplayName,
  sessionDurationMs,
  sessionStatusBucket,
  type StatusBucket,
} from '../builds/derive';
import { sentenceCase } from '../../lib/labels';
import { BugReportButton } from '../bug-report/BugReportButton';

const STATUS: Record<StatusBucket, { label?: string; Icon: LucideIcon; cls: string }> = {
  passed: { label: 'Passed', Icon: CheckCircle2, cls: 'text-[var(--color-success)]' },
  failed: { label: 'Failed', Icon: XCircle, cls: 'text-[var(--color-danger)]' },
  running: { label: 'Running', Icon: Loader2, cls: 'text-[var(--color-warning)]' },
  other: { Icon: CircleDashed, cls: 'text-[var(--text-dim)]' },
};

/** The status of a session in the list's words, with its icon and colour. */
export function sessionStatusView(status: string | null | undefined) {
  const bucket = sessionStatusBucket(status);
  const view = STATUS[bucket];
  return { bucket, ...view, label: view.label ?? sentenceCase(status || 'unknown') };
}

/**
 * The top of the session detail page: how the session ended and what it was,
 * then the phone, where it ran, who ran it, when, and for how long.
 */
export const OutcomeHeader: React.FC<{ session: ISession }> = ({ session }) => {
  const status = sessionStatusView(session.status);
  const title = sessionDisplayName(session);
  const os = [platformLabel(session), session.device_version]
    .filter((p) => p && p !== '—')
    .join(' ');
  const meta = [
    [deviceNameOrFallback(session), os].filter(Boolean).join(' · '),
    ranOnLabel(session.ranOn),
    session.owner?.name,
    formatMonthDayTime(session.startTime),
    compactDuration(sessionDurationMs(session)),
  ].filter((part) => part && part !== '—');

  return (
    <header className="flex items-start justify-between gap-4 px-4 py-4 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium shrink-0 ${status.cls}`}
          >
            <status.Icon
              className={`h-3.5 w-3.5 ${status.bucket === 'running' ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {status.label}
          </span>
          <h1
            className={`text-lg font-semibold truncate ${
              title.source === 'name' ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'
            }`}
            title={
              title.source === 'name'
                ? title.text
                : `${title.text}\nUnnamed session. Set xe:options.name in its capabilities to name it.`
            }
          >
            {title.text}
          </h1>
        </div>
        <p
          data-testid="outcome-meta"
          className="mt-1 text-xs text-[var(--text-muted)] tabular-nums truncate"
          title={session.owner?.email ?? undefined}
        >
          {meta.join(' · ')}
        </p>
      </div>
      <div className="shrink-0">
        <BugReportButton sessionId={session.id} mode="full" variant="inline" />
      </div>
    </header>
  );
};
