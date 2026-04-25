import React, { useState, useMemo } from 'react';
import { LogTabBar, type LogTab } from './log-tab-bar';
import { LogRow } from './log-row';
import { filterErrorsOnly, type LogTabKey } from './log-derive';
import type { LogLike } from './derive';

interface Props {
  sessionLogs: LogLike[];
  deviceLogs: LogLike[];
  debugLogs: LogLike[];
  profiling: unknown[];
}

export const LogViewer: React.FC<Props> = ({ sessionLogs, deviceLogs, debugLogs, profiling }) => {
  const [active, setActive] = useState<LogTabKey>('text');
  const [errorsOnly, setErrorsOnly] = useState(false);

  const tabs: LogTab[] = useMemo(
    () => [
      { key: 'text', label: 'Text Logs', count: sessionLogs.length },
      { key: 'performance', label: 'Performance Trace', count: 0 },
      { key: 'evidence', label: 'Evidence', count: 0 },
      { key: 'device', label: 'Device Logs', count: deviceLogs.length },
      { key: 'debug', label: 'Debug Logs', count: debugLogs.length },
      { key: 'profiling', label: 'System Profiling', count: profiling.length, hideWhenEmpty: true },
    ],
    [sessionLogs.length, deviceLogs.length, debugLogs.length, profiling.length],
  );

  const rows = useMemo<LogLike[]>(() => {
    let src: LogLike[] = [];
    if (active === 'text') src = sessionLogs;
    else if (active === 'device') src = deviceLogs;
    else if (active === 'debug') src = debugLogs;
    else if (active === 'profiling') src = profiling as LogLike[];
    return filterErrorsOnly(src, errorsOnly);
  }, [active, sessionLogs, deviceLogs, debugLogs, profiling, errorsOnly]);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] flex flex-col min-h-[280px]">
      <LogTabBar
        tabs={tabs}
        active={active}
        onChange={setActive}
        errorsOnly={errorsOnly}
        onErrorsOnlyChange={setErrorsOnly}
      />

      <div className="flex-1 overflow-y-auto">
        {active === 'performance' && (
          <div className="px-4 py-10 text-center text-xs text-[var(--text-dim)]">
            Performance Trace will be wired up once a session emits trace data.
          </div>
        )}
        {active === 'evidence' && (
          <div className="px-4 py-10 text-center text-xs text-[var(--text-dim)]">
            Evidence (screenshots) will be wired up alongside the screenshot service.
          </div>
        )}
        {(active === 'text' || active === 'device' || active === 'debug' || active === 'profiling') &&
          (rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-[var(--text-dim)]">
              {errorsOnly
                ? 'No error rows in this tab.'
                : 'No log entries in this tab.'}
            </div>
          ) : (
            rows.map((log, i) => <LogRow key={(log as any).id ?? i} log={log} />)
          ))}
      </div>
    </section>
  );
};
