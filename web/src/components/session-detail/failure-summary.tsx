import React from 'react';
import { AlertTriangle, Copy, ArrowUpRight } from 'lucide-react';
import type { ISession } from '../../interfaces/ISession';
import { useToast } from '../ui/toast';
import {
  firstErrorLog,
  parseStackFromReason,
  humanizeFailureCategory,
  type LogLike,
} from './derive';

interface Props {
  session: ISession;
  buildName: string;
  buildId: string;
  allLogs: LogLike[];
  durationText: string;
}

function buildCopyReport(
  session: ISession,
  buildName: string,
  buildId: string,
  durationText: string,
  firstError: LogLike | null,
): string {
  const category = humanizeFailureCategory(session.failure_category);
  const deviceLabel = session.device_name?.trim() || 'Unknown Device';
  const platformVersion = session.device_version ? ` ${session.device_version}` : '';
  const firstErrorText =
    firstError?.message ||
    (firstError ? JSON.stringify(firstError).slice(0, 200) : '(no logs captured)');
  return [
    `**Session:** ${session.id}`,
    `**Build:** ${buildName} (#${buildId})`,
    `**Device:** ${deviceLabel} (${session.node_id || 'unknown-node'}) · ${session.device_platform || 'unknown'}${platformVersion}`,
    `**Duration:** ${durationText}`,
    `**Failure category:** ${category || '(uncategorized)'}`,
    `**Failure reason:** ${session.failure_reason || '(not set)'}`,
    `**First error:** ${firstErrorText}`,
  ].join('\n');
}

export const FailureSummary: React.FC<Props> = ({ session, buildName, buildId, allLogs, durationText }) => {
  const { toast } = useToast();
  const category = humanizeFailureCategory(session.failure_category);
  const firstError = firstErrorLog(allLogs);
  const stack = parseStackFromReason(session.failure_reason);
  const showStack = stack.length > 0;

  const copyReport = async () => {
    const text = buildCopyReport(session, buildName, buildId, durationText, firstError);
    try {
      await navigator.clipboard.writeText(text);
      toast('Failure report copied', 'success');
    } catch {
      toast('Clipboard unavailable', 'error');
    }
  };

  const runbookHref = session.failure_category
    ? `/xenon/runbooks/${encodeURIComponent(session.failure_category.toLowerCase())}`
    : undefined;

  return (
    <section className="rounded-lg border border-[var(--red)]/30 bg-[var(--surface)] overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-4 py-3 border-b border-[var(--border)] bg-[var(--red)]/5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[var(--red)]" />
          <span className="text-sm font-semibold text-[var(--red)]">Failure summary</span>
          {category && (
            <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-dim)] ml-2">
              {category}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyReport}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-[var(--border)] text-xs text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <Copy className="h-3 w-3" />
            Copy
          </button>
          <a
            {...(runbookHref
              ? { href: runbookHref, target: '_blank', rel: 'noreferrer' }
              : { 'aria-disabled': true, onClick: (e: React.MouseEvent) => e.preventDefault() })}
            className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-[var(--border)] text-xs text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] transition-colors ${runbookHref ? '' : 'opacity-50 cursor-not-allowed'}`}
            title={runbookHref ? 'Open runbook in new tab' : 'No runbook — failure category not set'}
          >
            <ArrowUpRight className="h-3 w-3" />
            Open runbook
          </a>
        </div>
      </header>

      <div className="px-4 py-4 space-y-4">
        <div>
          <div className="text-[10px] font-mono font-semibold uppercase tracking-widest text-[var(--text-dim)] mb-1">
            Reason
          </div>
          <div className="text-sm text-[var(--text)]">
            {session.failure_reason || <span className="text-[var(--text-dim)]">(not set)</span>}
          </div>
        </div>

        <div>
          <div className="text-[10px] font-mono font-semibold uppercase tracking-widest text-[var(--text-dim)] mb-1">
            First error
          </div>
          <div className="text-sm text-[var(--text-muted)]">
            {firstError?.message
              ? firstError.message
              : firstError
              ? <code className="font-mono text-xs">{JSON.stringify(firstError).slice(0, 400)}</code>
              : <span className="text-[var(--text-dim)]">(no logs captured before failure)</span>}
          </div>
        </div>

        {showStack && (
          <div>
            <div className="text-[10px] font-mono font-semibold uppercase tracking-widest text-[var(--text-dim)] mb-1">
              Stack trace
            </div>
            <pre className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-[11px] leading-relaxed text-[var(--green)] overflow-x-auto">
              {stack.join('\n')}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
};
