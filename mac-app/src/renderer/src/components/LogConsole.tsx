import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { LogLine } from '@shared/types';
import { Play } from 'lucide-react';
import { parseAnsi } from '../ansi';
import { cn } from '../cn';
import type { UiLogLine } from '../logBuffer';
import { Button } from './ui/Button';
import { toast } from './ui/toastStore';

/** Visible text of a log line, with ANSI escape sequences removed. */
function stripAnsi(text: string): string {
  return parseAnsi(text)
    .map((s) => s.text)
    .join('');
}

interface Props {
  logs: UiLogLine[];
  onClear: () => void;
  /** Offered in the empty state when the server isn't running. */
  onStart?: () => void;
}

/**
 * One log line. Memoised and keyed by a stable id, so a new line re-renders
 * only itself rather than the whole buffer. `log-row` carries
 * content-visibility, letting the browser skip layout/paint for offscreen rows
 * — which handles wrapped, variable-height lines that JS windowing can't size.
 */
const LogRow = memo(function LogRow({ line }: { line: UiLogLine }) {
  const segments = useMemo(() => parseAnsi(line.text), [line.text]);
  return (
    <div className={cn('log-row whitespace-pre-wrap break-words', STREAM_COLOR[line.stream])}>
      {segments.map((seg, i) =>
        seg.color ? (
          <span key={i} style={{ color: seg.color }}>
            {seg.text}
          </span>
        ) : (
          seg.text
        )
      )}
    </div>
  );
});

const STREAM_COLOR: Record<LogLine['stream'], string> = {
  stdout: 'text-ink',
  stderr: 'text-danger',
  system: 'text-info'
};

export function LogConsole({ logs, onClear, onStart }: Props) {
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
        <span className="whitespace-nowrap font-mono text-[11px] text-dim">
          {filtered.length.toLocaleString()}
          {filter.trim() ? ` / ${logs.length.toLocaleString()}` : ''} lines
        </span>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
          auto-scroll
        </label>
        <Button size="sm" onClick={copyAll}>
          Copy
        </Button>
        <Button size="sm" onClick={onClear} disabled={logs.length === 0}>
          Clear
        </Button>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-line bg-app p-3 font-mono text-xs leading-relaxed">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-dim">
              {logs.length === 0 ? 'No output yet. Start the server to see logs.' : `No lines match ‘${filter.trim()}’.`}
            </p>
            {logs.length === 0 && onStart && (
              <Button size="sm" variant="primary" onClick={onStart} icon={<Play size={12} />}>
                Start server
              </Button>
            )}
          </div>
        ) : (
          filtered.map((l) => <LogRow key={l.id} line={l} />)
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
