import React, { useState, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LogTabBar, type LogTab } from './log-tab-bar';
import { LogRow } from './log-row';
import { filterErrorsOnly, type LogTabKey } from './log-derive';
import type { LogLike } from './derive';
import { commandStats, type CommandLog } from './commands';
import { CommandTimeline } from './command-timeline';
import { ScreenshotGrid } from './screenshot-grid';

interface Props {
  /** The command log (SessionLog rows), newest first. */
  sessionLogs: LogLike[];
  deviceLogs: LogLike[];
  debugLogs: LogLike[];
  profiling: unknown[];
}

const LIST_TABS: LogTabKey[] = ['commands', 'device', 'debug', 'profiling'];

/**
 * From this many rows a tab draws only the rows on screen. An Android
 * session's Device logs hold up to 12,000 lines: drawn whole, that was 145,000
 * elements, and opening the tab or ticking "Errors only" froze the page for
 * 2 to 4 seconds.
 */
export const VIRTUAL_FROM = 500;
/** A one-line row's height, until the row is measured. */
const ROW_PX = 33;

/** A long list's rows, only those on screen (and a few each side) drawn. */
const VirtualRows: React.FC<{
  rows: LogLike[];
  scroller: React.RefObject<HTMLDivElement>;
}> = ({ rows, scroller }) => {
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_PX,
    getItemKey: (i) => (rows[i] as any).id ?? i,
    overscan: 20,
  });
  return (
    <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => (
        // The row's own bottom border is its last child's; the line between
        // rows is drawn here instead. An opened row is measured again.
        <div
          key={String(item.key)}
          data-index={item.index}
          ref={virtualizer.measureElement}
          className={`absolute left-0 top-0 w-full${
            item.index < rows.length - 1 ? ' border-b border-[var(--border)]' : ''
          }`}
          style={{ transform: `translateY(${item.start}px)` }}
        >
          <LogRow log={rows[item.index]} />
        </div>
      ))}
    </div>
  );
};

export const LogViewer: React.FC<Props> = ({ sessionLogs, deviceLogs, debugLogs, profiling }) => {
  const [active, setActive] = useState<LogTabKey>('commands');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const commands = sessionLogs as CommandLog[];
  const screenshots = useMemo(() => commandStats(commands).screenshots, [commands]);

  const tabs: LogTab[] = useMemo(
    () => [
      { key: 'commands', label: 'Commands', count: sessionLogs.length },
      { key: 'timeline', label: 'Timeline', count: sessionLogs.length },
      { key: 'screenshots', label: 'Screenshots', count: screenshots },
      { key: 'device', label: 'Device logs', count: deviceLogs.length },
      { key: 'debug', label: 'Debug logs', count: debugLogs.length },
      { key: 'profiling', label: 'System profiling', count: profiling.length, hideWhenEmpty: true },
    ],
    [sessionLogs.length, screenshots, deviceLogs.length, debugLogs.length, profiling.length],
  );

  const rows = useMemo<LogLike[]>(() => {
    let src: LogLike[] = [];
    if (active === 'commands') src = sessionLogs;
    else if (active === 'device') src = deviceLogs;
    else if (active === 'debug') src = debugLogs;
    else if (active === 'profiling') src = profiling as LogLike[];
    return filterErrorsOnly(src, errorsOnly);
  }, [active, sessionLogs, deviceLogs, debugLogs, profiling, errorsOnly]);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] flex flex-col min-h-[280px] max-h-[640px]">
      <LogTabBar
        tabs={tabs}
        active={active}
        onChange={setActive}
        errorsOnly={errorsOnly}
        onErrorsOnlyChange={setErrorsOnly}
        showErrorsOnly={LIST_TABS.includes(active)}
      />

      <div ref={scroller} className="flex-1 overflow-y-auto" data-log-scroller="">
        {active === 'timeline' && <CommandTimeline commands={commands} />}
        {active === 'screenshots' && <ScreenshotGrid commands={commands} />}
        {LIST_TABS.includes(active) &&
          (rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-[var(--text-dim)]">
              {errorsOnly ? 'No error rows in this tab.' : 'No log entries in this tab.'}
            </div>
          ) : rows.length >= VIRTUAL_FROM ? (
            <VirtualRows key={active} rows={rows} scroller={scroller} />
          ) : (
            rows.map((log, i) => <LogRow key={(log as any).id ?? i} log={log} />)
          ))}
      </div>
    </section>
  );
};
