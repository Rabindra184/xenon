import React, { useState } from 'react';
import { ChevronRight, Copy } from 'lucide-react';
import type { LogLike } from './derive';
import { logTimestamp, logRowKind, logDisplayTitle, logDisplaySubtitle } from './log-derive';
import { JsonBlock } from './json-block';
import { useToast } from '../ui/toast';

interface Props {
  log: LogLike;
}

const dotCls: Record<ReturnType<typeof logRowKind>['tone'], string> = {
  green:   'bg-[var(--green)]',
  red:     'bg-[var(--red)]',
  amber:   'bg-[var(--amber)]',
  blue:    'bg-[var(--blue)]',
  neutral: 'bg-[var(--text-dim)]',
};

const labelCls: Record<ReturnType<typeof logRowKind>['tone'], string> = {
  green:   'text-[var(--green)]',
  red:     'text-[var(--red)]',
  amber:   'text-[var(--amber)]',
  blue:    'text-[var(--blue)]',
  neutral: 'text-[var(--text-muted)]',
};

export const LogRow: React.FC<Props> = ({ log }) => {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const ts = logTimestamp(log);
  const kind = logRowKind(log);

  const copyJson = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const body = (log as any).body ?? log;
      const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
      await navigator.clipboard.writeText(text);
      toast('Log entry copied', 'success');
    } catch {
      toast('Clipboard unavailable', 'error');
    }
  };

  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--surface-2)]/60 transition-colors"
      >
        <ChevronRight className={`h-3 w-3 text-[var(--text-dim)] transition-transform shrink-0 ${open ? 'rotate-90' : ''}`} />
        <span className="font-mono text-[11px] text-[var(--text-muted)] w-[64px] shrink-0">{ts}</span>
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotCls[kind.tone]}`} />
        <span className={`font-mono text-[11px] font-medium shrink-0 ${labelCls[kind.tone]}`}>{kind.label}</span>
        <span className="min-w-0 flex-1 flex items-baseline gap-2 truncate">
          <span className="text-[12px] text-[var(--text)] shrink-0">{logDisplayTitle(log)}</span>
          {logDisplaySubtitle(log) && (
            <span className="font-mono text-[11px] text-[var(--text-dim)] truncate min-w-0">
              {logDisplaySubtitle(log)}
            </span>
          )}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={copyJson}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') copyJson(e as unknown as React.MouseEvent); }}
          aria-label="Copy log entry"
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--text-dim)] hover:text-[var(--text)] transition-opacity shrink-0"
        >
          <Copy className="h-3 w-3" />
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 pl-9">
          <JsonBlock value={(log as any).body ?? log} maxHeightPx={400} />
        </div>
      )}
    </div>
  );
};
