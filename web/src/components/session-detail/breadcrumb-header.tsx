import React from 'react';
import { ArrowLeft, Copy, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useToast } from '../ui/toast';
import { BugReportButton } from '../bug-report/BugReportButton';

interface Props {
  buildId: string;
  /** null when the build isn't known (gone, or a session with none): no build crumb. */
  buildName: string | null;
  sessionId: string;
}

export const BreadcrumbHeader: React.FC<Props> = ({ buildId, buildName, sessionId }) => {
  const { toast } = useToast();

  const copySessionId = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      toast('Session ID copied', 'success');
    } catch {
      toast('Failed to copy (clipboard unavailable)', 'error');
    }
  };

  return (
    <header className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
      <Link
        to="/builds"
        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Sessions
      </Link>
      <ChevronRight className="h-3 w-3 text-[var(--text-dim)]" />
      {buildName && (
        <>
          <Link
            to={`/builds/${buildId}`}
            className="text-[11px] text-[var(--color-accent)] hover:underline"
          >
            {buildName}
          </Link>
          <ChevronRight className="h-3 w-3 text-[var(--text-dim)]" />
        </>
      )}
      <span className="font-mono text-xs text-[var(--text)]" title={sessionId}>
        #{sessionId}
      </span>
      <button
        type="button"
        onClick={copySessionId}
        aria-label="Copy session ID"
        className="p-1 rounded text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
      >
        <Copy className="h-3 w-3" />
      </button>
      <div className="ml-auto">
        <BugReportButton sessionId={sessionId} mode="full" variant="inline" />
      </div>
    </header>
  );
};
