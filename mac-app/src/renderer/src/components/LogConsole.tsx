import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogLine } from '@shared/types';
import { cn } from '../cn';

interface Props {
  logs: LogLine[];
}

const STREAM_COLOR: Record<LogLine['stream'], string> = {
  stdout: 'text-slate-300',
  stderr: 'text-rose-300',
  system: 'text-sky-300'
};

export function LogConsole({ logs }: Props) {
  const [filter, setFilter] = useState('');
  const [autoscroll, setAutoscroll] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!filter.trim()) return logs;
    const f = filter.toLowerCase();
    return logs.filter((l) => l.text.toLowerCase().includes(f));
  }, [logs, filter]);

  useEffect(() => {
    if (autoscroll) endRef.current?.scrollIntoView({ block: 'end' });
  }, [filtered, autoscroll]);

  const copyAll = () => navigator.clipboard.writeText(logs.map((l) => l.text).join('\n'));

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2">
        <input
          placeholder="Filter logs…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
          auto-scroll
        </label>
        <button onClick={copyAll} className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-600">
          Copy
        </button>
      </div>
      <div className="flex-1 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed">
        {filtered.length === 0 ? (
          <p className="text-slate-500">No output yet. Start the server to see logs.</p>
        ) : (
          filtered.map((l, i) => (
            <div key={i} className={cn('whitespace-pre-wrap break-words', STREAM_COLOR[l.stream])}>
              {l.text}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
