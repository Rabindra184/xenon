import React from 'react';
import { ArrowLeft, Copy, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useToast } from '../ui/toast';
import { BugReportButton } from '../bug-report/BugReportButton';

interface Props {
  buildId: string;
  buildName: string;
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
        to={`/builds/${buildId}`}
        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Builds
      </Link>
      <ChevronRight className="h-3 w-3 text-[var(--text-dim)]" />
      <Link
        to={`/builds/${buildId}`}
        className="text-[10px] uppercase tracking-widest font-mono text-[var(--green)] hover:underline"
      >
        {buildName}
      </Link>
      <ChevronRight className="h-3 w-3 text-[var(--text-dim)]" />
      <span className="text-[10px] uppercase tracking-widest text-[var(--text-dim)]">Sessions</span>
      <ChevronRight className="h-3 w-3 text-[var(--text-dim)]" />
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
