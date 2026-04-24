import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export const SessionDetailStub: React.FC = () => {
  const { buildId, sessionId } = useParams<{ buildId: string; sessionId: string }>();
  return (
    <div className="p-6">
      <Link
        to={`/builds/${buildId}`}
        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        <ArrowLeft className="h-3 w-3" /> Back to sessions
      </Link>
      <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="text-sm text-[var(--text-muted)]">
          Session Detail page lands in Plan 4C.
        </div>
        <div className="mt-2 font-mono text-[10px] text-[var(--text-dim)]">
          build: {buildId}
          <br />
          session: {sessionId}
        </div>
      </div>
    </div>
  );
};

export default SessionDetailStub;
