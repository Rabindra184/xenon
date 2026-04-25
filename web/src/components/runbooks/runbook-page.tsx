import React from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { lookupRunbook } from './runbook-content';
import './runbook-page.css';

export const RunbookPage: React.FC = () => {
  const { category } = useParams<{ category: string }>();
  const rb = lookupRunbook(category);
  const isFallback = !category || (category && lookupRunbook(category).title === 'Unknown' && category.toLowerCase() !== 'unknown');

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center justify-between gap-4 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
        <Link
          to="/builds"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to builds
        </Link>
        <div className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
          <BookOpen className="h-3.5 w-3.5" />
          <span className="font-mono uppercase tracking-widest">Runbook</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <article className="max-w-3xl mx-auto px-6 py-8 prose prose-invert prose-sm runbook-prose">
          {isFallback && (
            <div className="mb-4 rounded-md border border-[var(--amber)]/30 bg-[var(--amber)]/5 px-3 py-2 text-xs text-[var(--amber)]">
              No runbook for category <code className="font-mono">{category}</code> — showing the fallback.
            </div>
          )}
          <ReactMarkdown>{rb.markdown}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
};

export default RunbookPage;
