import React, { useState } from 'react';
import { AlertTriangle, Copy, ArrowUpRight, Sparkles } from 'lucide-react';
import type { ISession } from '../../interfaces/ISession';
import { useToast } from '../ui/toast';
import { parseStackFromReason, humanizeFailureCategory } from './derive';
import { commandErrorMessage, isFailedCommand, type CommandLog } from './commands';

interface Props {
  session: ISession;
  buildName: string;
  buildId: string;
  /** The session's command log, newest first. */
  commands: CommandLog[];
  durationText: string;
}

/** The first command that failed, and what it said. */
function firstFailure(commands: CommandLog[]): { command: string; message: string | null } | null {
  const failed = commands.filter(isFailedCommand);
  const first = failed[failed.length - 1];
  if (!first) return null;
  return {
    command: first.command_name || first.title || 'command',
    message: commandErrorMessage(first),
  };
}

function buildCopyReport(
  session: ISession,
  buildName: string,
  buildId: string,
  durationText: string,
  failure: ReturnType<typeof firstFailure>,
): string {
  const category = humanizeFailureCategory(session.failure_category);
  const deviceLabel = session.device_name?.trim() || 'Unknown Device';
  const platformVersion = session.device_version ? ` ${session.device_version}` : '';
  const failureText = failure
    ? `${failure.command}${failure.message ? `: ${failure.message}` : ''}`
    : '(no failed command recorded)';
  return [
    `**Session:** ${session.id}`,
    `**Build:** ${buildName} (#${buildId})`,
    `**Device:** ${deviceLabel} (${session.node_id || 'unknown-node'}) · ${session.device_platform || 'unknown'}${platformVersion}`,
    `**Duration:** ${durationText}`,
    `**Failure category:** ${category || '(uncategorized)'}`,
    `**Failure reason:** ${session.failure_reason || '(not set)'}`,
    `**First failed command:** ${failureText}`,
    ...(session.ai_analysis ? [`**AI analysis:** ${session.ai_analysis}`] : []),
  ].join('\n');
}

/**
 * The AI analysis as written: paragraphs, **bold** and `code`. Nothing else
 * of Markdown is rendered, and no HTML is ever interpreted.
 */
function AnalysisText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (/^`[^`]+`$/.test(part)) {
          return (
            <code key={i} className="font-mono text-[11px] px-1 rounded bg-[var(--surface-2)]">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[11px] font-semibold text-[var(--text-dim)] mb-1">{children}</div>
);

/** Why a failed session failed: the reason, the first failed command, the AI's analysis. */
export const FailureSummary: React.FC<Props> = ({
  session,
  buildName,
  buildId,
  commands,
  durationText,
}) => {
  const { toast } = useToast();
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const category = humanizeFailureCategory(session.failure_category);
  const failure = firstFailure(commands);
  const stack = parseStackFromReason(session.failure_reason);
  const analysis = session.ai_analysis?.trim();
  const longAnalysis = !!analysis && analysis.length > 480;

  const copyReport = async () => {
    const text = buildCopyReport(session, buildName, buildId, durationText, failure);
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
          <AlertTriangle className="h-4 w-4 text-[var(--red)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[var(--red)]">Why it failed</h2>
          {category && <span className="text-[11px] text-[var(--text-dim)] ml-2">{category}</span>}
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
            title={
              runbookHref ? 'Open runbook in new tab' : 'No runbook — failure category not set'
            }
          >
            <ArrowUpRight className="h-3 w-3" />
            Open runbook
          </a>
        </div>
      </header>

      <div className="px-4 py-4 space-y-4">
        <div>
          <Label>Reason</Label>
          <div className="text-sm text-[var(--text)] break-words">
            {session.failure_reason || <span className="text-[var(--text-dim)]">(not set)</span>}
          </div>
        </div>

        <div>
          <Label>First failed command</Label>
          {failure ? (
            <div className="flex items-baseline gap-2 min-w-0 text-sm">
              <span className="font-mono text-xs text-[var(--color-danger)] shrink-0">
                {failure.command}
              </span>
              {failure.message && (
                <span className="text-[var(--text-muted)] break-words min-w-0">
                  {failure.message}
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-[var(--text-dim)]">No failed command recorded.</span>
          )}
        </div>

        {analysis && (
          <div data-testid="ai-analysis">
            <Label>
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                AI analysis
              </span>
            </Label>
            <div
              className={`text-sm text-[var(--text)] whitespace-pre-wrap break-words ${
                longAnalysis && !analysisOpen ? 'line-clamp-6' : ''
              }`}
            >
              <AnalysisText text={analysis} />
            </div>
            {longAnalysis && (
              <button
                type="button"
                onClick={() => setAnalysisOpen((o) => !o)}
                aria-expanded={analysisOpen}
                className="mt-1 text-xs text-[var(--color-accent)] hover:underline"
              >
                {analysisOpen ? 'Show less' : 'Show all'}
              </button>
            )}
          </div>
        )}

        {stack.length > 0 && (
          <div>
            <Label>Stack trace</Label>
            <pre className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-[11px] leading-relaxed text-[var(--color-accent)] overflow-x-auto">
              {stack.join('\n')}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
};
