import React from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Props {
  buildId: string;
  /** null when the build isn't known (gone, or a session with none): no build crumb. */
  buildName: string | null;
  sessionId: string;
}

/**
 * Where the session sits: Sessions, its build, its short id. The session's
 * name, status and actions are the outcome header's, below it.
 */
export const BreadcrumbHeader: React.FC<Props> = ({ buildId, buildName, sessionId }) => (
  <nav
    aria-label="Breadcrumb"
    className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]"
  >
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
    <span className="font-mono text-[11px] text-[var(--text-muted)]" title={sessionId}>
      #{sessionId.slice(0, 8)}
    </span>
  </nav>
);
