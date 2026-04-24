import React from 'react';
import { RefreshCcw, Download } from 'lucide-react';
import type { IBuild } from '../../interfaces/IBuild';

function shortBuildId(id: string): string {
  // Use the leading 8 chars (uppercased) matching the reference "BUILD #A70AC97A" look.
  const first = id.split('-')[0] || id;
  return first.slice(0, 8).toUpperCase();
}

interface Props {
  build: IBuild;
  failedCount: number;
  selectedCount: number;
  onRetryFailed: () => void;
  onExport: (format: 'json' | 'csv') => void;
}

export const BuildsHeader: React.FC<Props> = ({
  build,
  failedCount,
  selectedCount,
  onRetryFailed,
  onExport,
}) => {
  const canRetry = failedCount > 0 || selectedCount > 0;
  const [exportOpen, setExportOpen] = React.useState(false);
  const wrap = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const retryTooltip = canRetry
    ? `Retry ${selectedCount || failedCount} session${(selectedCount || failedCount) === 1 ? '' : 's'}`
    : 'No failed sessions to retry';

  return (
    <header className="flex items-start justify-between gap-4 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
      <div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--text-dim)]">
          <span>Build</span>
          <span className="font-mono text-[var(--green)]" title={build.id}>
            #{shortBuildId(build.id)}
          </span>
        </div>
        <h1 className="mt-0.5 text-sm font-semibold text-[var(--text)]">
          {build.name || 'Unnamed build'}
        </h1>
      </div>

      <div className="flex items-center gap-2" ref={wrap}>
        <button
          type="button"
          onClick={onRetryFailed}
          disabled={!canRetry}
          title={retryTooltip}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-[var(--border)] text-xs text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          Retry failed
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-[var(--border)] text-xs text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
          {exportOpen && (
            <div className="absolute top-full right-0 mt-1 w-40 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden z-20">
              <button
                type="button"
                onClick={() => { setExportOpen(false); onExport('json'); }}
                className="w-full text-left px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--surface-2)]"
              >
                Export as JSON
              </button>
              <button
                type="button"
                onClick={() => { setExportOpen(false); onExport('csv'); }}
                className="w-full text-left px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--surface-2)]"
              >
                Export as CSV
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
