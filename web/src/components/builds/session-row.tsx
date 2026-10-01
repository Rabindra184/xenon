import React from 'react';
import {
  ChevronRight,
  Smartphone,
  Tv,
  Tablet,
  Monitor,
  CheckCircle2,
  XCircle,
  Loader2,
  CircleDashed,
  type LucideIcon,
} from 'lucide-react';
import type { ISession } from '../../interfaces/ISession';
import {
  formatAbsoluteTime,
  formatStartTime,
  compactDuration,
  deviceNameOrFallback,
  platformLabel,
  sessionDurationMs,
  sessionStatusBucket,
  sessionDisplayName,
  ranOnLabel,
  type StatusBucket,
} from './derive';
import { sentenceCase } from '../../lib/labels';

interface Props {
  session: ISession;
  /** The session's build, as the builds column names it. */
  buildName?: string | null;
  /** Show the build under the test name (the all-sessions view). */
  showBuild: boolean;
  /** Show a selection checkbox (a build's view, for export). */
  showSelection: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}

function DeviceIcon({ platform }: { platform?: string }) {
  const p = (platform || '').toLowerCase();
  const cls = 'h-3.5 w-3.5 shrink-0 text-[var(--text-dim)]';
  if (p.includes('tv')) return <Tv className={cls} />;
  if (p.includes('pad') || p.includes('tablet')) return <Tablet className={cls} />;
  if (p.includes('android') || p.includes('ios')) return <Smartphone className={cls} />;
  return <Monitor className={cls} />;
}

const STATUS: Record<StatusBucket, { label?: string; Icon: LucideIcon; cls: string }> = {
  passed: { label: 'Passed', Icon: CheckCircle2, cls: 'text-[var(--color-success)]' },
  failed: { label: 'Failed', Icon: XCircle, cls: 'text-[var(--color-danger)]' },
  running: { label: 'Running', Icon: Loader2, cls: 'text-[var(--color-warning)]' },
  other: { Icon: CircleDashed, cls: 'text-[var(--text-dim)]' },
};

const NAME_HINT = 'Unnamed session. Set xe:options.name in its capabilities to name it.';

export const SessionRow: React.FC<Props> = ({
  session,
  buildName,
  showBuild,
  showSelection,
  selected,
  onToggleSelect,
  onOpen,
}) => {
  const bucket = sessionStatusBucket(session.status);
  const status = STATUS[bucket];
  const failed = bucket === 'failed';
  const title = sessionDisplayName(session);
  const reason = failed ? session.failure_reason?.trim() : '';
  const os = [platformLabel(session), session.device_version]
    .filter((p) => p && p !== '—')
    .join(' ');
  const device = [deviceNameOrFallback(session), os].filter(Boolean).join(' · ');
  const where = [ranOnLabel(session.ranOn), session.owner?.name].filter(Boolean).join(' · ');
  // A failure's red edge goes on the row's first cell, whichever that is.
  const edge = failed ? 'shadow-[inset_3px_0_0_var(--color-danger)]' : '';

  return (
    <tr
      onClick={onOpen}
      data-outcome={bucket}
      className={`group border-b border-[var(--border)] cursor-pointer transition-colors ${
        failed
          ? 'bg-[rgb(var(--rgb-red)/0.04)] hover:bg-[rgb(var(--rgb-red)/0.08)]'
          : 'hover:bg-[var(--surface-2)]'
      }`}
    >
      {showSelection && (
        <td className={`pl-4 pr-2 py-3 align-top ${edge}`} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select session ${title.text}`}
          />
        </td>
      )}
      <td className={`px-4 py-3 align-top ${showSelection ? '' : edge}`}>
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${status.cls}`}>
          <status.Icon
            className={`h-3.5 w-3.5 shrink-0 ${bucket === 'running' ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {status.label ?? sentenceCase(session.status || 'unknown')}
        </span>
      </td>
      <td className="px-3 py-3 align-top min-w-0">
        <div
          className={`text-[13px] font-medium truncate ${
            title.source === 'name' ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'
          }`}
          title={title.source === 'name' ? title.text : `${title.text}\n${NAME_HINT}`}
        >
          {title.text}
        </div>
        {reason ? (
          <div className="mt-0.5 text-[11px] text-[var(--color-danger)] truncate" title={reason}>
            {reason}
          </div>
        ) : (
          showBuild &&
          buildName && (
            <div className="mt-0.5 text-[11px] text-[var(--text-muted)] truncate" title={buildName}>
              {buildName}
            </div>
          )
        )}
      </td>
      <td className="px-3 py-3 align-top min-w-0">
        <div className="flex items-center gap-1.5 text-[13px] text-[var(--text)] min-w-0">
          <DeviceIcon platform={session.device_platform} />
          <span className="truncate" title={session.device_udid}>
            {device}
          </span>
        </div>
        {where && (
          <div
            className="mt-0.5 text-[11px] text-[var(--text-muted)] truncate"
            title={[
              session.ranOn === 'here' ? null : `Node ${session.node_id}`,
              session.owner?.email,
            ]
              .filter(Boolean)
              .join('\n')}
          >
            {where}
          </div>
        )}
      </td>
      <td
        className="px-3 py-3 align-top text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap"
        title={formatAbsoluteTime(session.startTime)}
      >
        {formatStartTime(session.startTime)}
      </td>
      <td className="px-3 py-3 align-top text-xs text-[var(--text)] tabular-nums whitespace-nowrap text-right">
        {compactDuration(sessionDurationMs(session))}
      </td>
      <td className="pr-4 pl-1 py-3 align-top text-right">
        <ChevronRight
          className="inline h-4 w-4 text-[var(--text-dim)] group-hover:text-[var(--text)]"
          aria-hidden="true"
        />
      </td>
    </tr>
  );
};
