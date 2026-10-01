import React from 'react';
import { formatCommandDuration, timelineLayout, type CommandLog } from './commands';

interface Props {
  commands: CommandLog[];
}

const barCls = (failed: boolean, healed: boolean) =>
  failed
    ? 'bg-[var(--color-danger)]'
    : healed
      ? 'bg-[var(--color-warning)]'
      : 'bg-[var(--color-success)]';

/**
 * Every command on one time axis, oldest first: where the session's time
 * went, and where it failed or healed.
 */
export const CommandTimeline: React.FC<Props> = ({ commands }) => {
  const { spanMs, bars } = timelineLayout(commands);
  if (bars.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-xs text-[var(--text-dim)]">
        No commands recorded for this session.
      </div>
    );
  }

  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between pb-2 text-[11px] text-[var(--text-dim)] tabular-nums">
        <span>
          {bars.length} command{bars.length === 1 ? '' : 's'} over {formatCommandDuration(spanMs)}
        </span>
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-[var(--color-danger)]" /> Failed
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-[var(--color-warning)]" /> Healed
          </span>
        </span>
      </div>
      <ol className="space-y-1">
        {bars.map((b, i) => (
          <li
            key={b.id ?? i}
            data-testid="timeline-bar"
            data-command={b.label}
            data-failed={b.failed ? 'true' : 'false'}
            className="grid grid-cols-[128px_minmax(0,1fr)_64px] items-center gap-2"
          >
            <span
              className="truncate text-[11px] font-mono text-[var(--text-muted)]"
              title={b.label}
            >
              {b.label}
            </span>
            <span className="relative h-3 rounded-sm bg-[rgb(var(--rgb-fg)/0.05)]">
              <span
                className={`absolute inset-y-0 rounded-sm ${barCls(b.failed, b.healed)}`}
                style={{
                  left: `${(b.startMs / spanMs) * 100}%`,
                  width: `max(2px, ${(b.durationMs / spanMs) * 100}%)`,
                }}
              />
            </span>
            <span className="text-right text-[11px] tabular-nums text-[var(--text-muted)]">
              {b.durationMs > 0 ? formatCommandDuration(b.durationMs) : '—'}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};
