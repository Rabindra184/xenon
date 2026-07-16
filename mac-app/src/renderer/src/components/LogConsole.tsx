import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogLine } from '@shared/types';
import { parseAnsi } from '../ansi';
import { cn } from '../cn';
import { toast } from './ui/toastStore';

/** Visible text of a log line, with ANSI escape sequences removed. */
function stripAnsi(text: string): string {
  return parseAnsi(text)
    .map((s) => s.text)
    .join('');
}

interface Props {
  logs: LogLine[];
}

const STREAM_COLOR: Record<LogLine['stream'], string> = {
  stdout: 'text-ink',
  stderr: 'text-danger',
  system: 'text-info'
};

export function LogConsole({ logs }: Props) {
  const [filter, setFilter] = useState('');
  const [autoscroll, setAutoscroll] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!filter.trim()) return logs;
    const f = filter.toLowerCase();
    return logs.filter((l) => stripAnsi(l.text).toLowerCase().includes(f));
  }, [logs, filter]);

  useEffect(() => {
    if (autoscroll) endRef.current?.scrollIntoView({ block: 'end' });
  }, [filtered, autoscroll]);

  const copyAll = () => {
    void navigator.clipboard.writeText(logs.map((l) => stripAnsi(l.text)).join('\n'));
    toast('Logs copied');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2">
        <input
          placeholder="Filter logs…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="focus-ring flex-1 rounded-md border border-line-strong bg-surface2 px-2 py-1 text-sm text-ink"
        />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
          auto-scroll
        </label>
        <button onClick={copyAll} className="focus-ring rounded-md border border-line-strong px-2 py-1 text-xs hover:bg-surface2">
          Copy
        </button>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-line bg-app p-3 font-mono text-xs leading-relaxed">
        {filtered.length === 0 ? (
          <p className="text-dim">No output yet. Start the server to see logs.</p>
        ) : (
          filtered.map((l, i) => (
            <div key={i} className={cn('whitespace-pre-wrap break-words', STREAM_COLOR[l.stream])}>
              {parseAnsi(l.text).map((seg, j) =>
                seg.color ? (
                  <span key={j} style={{ color: seg.color }}>
                    {seg.text}
                  </span>
                ) : (
                  seg.text
                )
              )}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
