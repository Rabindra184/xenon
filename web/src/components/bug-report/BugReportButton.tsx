import React, { useState } from 'react';
import { Bug, Loader2 } from 'lucide-react';
import { downloadBugReport } from '../../api-service/bug-report';
import { useToast } from '../ui/toast';

interface Props {
  sessionId: string;
  mode: 'slice' | 'full';
  windowSec?: number;
  variant: 'floating' | 'inline';
}

export const BugReportButton: React.FC<Props> = ({ sessionId, mode, windowSec, variant }) => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function onClick() {
    if (loading) return;
    setLoading(true);
    try {
      await downloadBugReport({ sessionId, mode, windowSec });
      toast('Bug report downloaded', 'success');
    } catch (err: any) {
      toast(`Bug report failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  if (variant === 'floating') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        title={`Capture last ${windowSec ?? 60}s as bug report`}
        aria-label="Generate bug report"
        className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 px-3 py-2 rounded-full
                   bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--text)]
                   shadow-lg hover:bg-[var(--surface-raised)] disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bug className="h-3.5 w-3.5" />}
        Bug report
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title="Download a zip of this session for ticketing"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs
                 bg-[var(--surface-2)] hover:bg-[var(--surface-raised)] border border-[var(--border)]
                 text-[var(--text)] disabled:opacity-50"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bug className="h-3.5 w-3.5" />}
      Download bug report
    </button>
  );
};
