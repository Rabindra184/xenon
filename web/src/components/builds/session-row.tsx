import React from 'react';
import { ChevronRight, Smartphone, Tv, Tablet, Monitor } from 'lucide-react';
import type { ISession } from '../../interfaces/ISession';
import {
  formatAbsoluteTime,
  humanDuration,
  deviceNameOrFallback,
  platformLabel,
  osVersionLabel,
  shortId,
  sessionDurationMs,
} from './derive';
import { StatusPillOutline, type StatusTone } from '../ui/status-pill-outline';

interface Props {
  session: ISession;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}

function DeviceIcon({ platform }: { platform?: string }) {
  const p = (platform || '').toLowerCase();
  if (p.includes('tv')) return <Tv className="h-3.5 w-3.5" />;
  if (p.includes('pad') || p.includes('tablet')) return <Tablet className="h-3.5 w-3.5" />;
  if (p.includes('android') || p.includes('ios')) return <Smartphone className="h-3.5 w-3.5" />;
  return <Monitor className="h-3.5 w-3.5" />;
}

function statusToPill(status: string): { label: string; tone: StatusTone } {
  if (status === 'running') return { label: 'RUNNING', tone: 'running' };
  if (status === 'failed')  return { label: 'FAILED',  tone: 'failed'  };
  if (status === 'ended' || status === 'passed') return { label: 'PASSED', tone: 'passed' };
  return { label: status.toUpperCase(), tone: 'offline' };
}

export const SessionRow: React.FC<Props> = ({ session, selected, onToggleSelect, onOpen }) => {
  const failed = session.status === 'failed';
  const pill = statusToPill(session.status);
  const deviceName = deviceNameOrFallback(session);
  const subtitleTop = failed && session.failure_reason
    ? session.failure_reason
    : (session.name ?? '');

  return (
    <tr
      onClick={onOpen}
      className="group border-b border-[var(--border)] hover:bg-[var(--surface-2)] cursor-pointer transition-colors align-top"
    >
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select session ${session.id}`}
        />
      </td>
      <td className="px-3 py-3">
        <div className="font-mono text-xs text-[var(--green)]" title={session.id}>
          #{shortId(session.id, 14, 4)}
        </div>
        {subtitleTop && (
          <div className="mt-0.5 text-[11px] text-[var(--text-muted)] truncate max-w-[420px]" title={subtitleTop}>
            {subtitleTop}
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1.5 text-xs text-[var(--text)]">
          <DeviceIcon platform={session.device_platform} />
          <span className="truncate max-w-[160px]">{deviceName}</span>
        </div>
        {session.node_id && (
          <div className="mt-0.5 font-mono text-[10px] text-[var(--text-dim)]">
            node-{session.node_id}
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="text-xs text-[var(--text)]">{platformLabel(session)}</div>
        {session.device_version && (
          <div className="mt-0.5 font-mono text-[10px] text-[var(--text-dim)]">{osVersionLabel(session)}</div>
        )}
      </td>
      <td className="px-3 py-3">
        <StatusPillOutline label={pill.label} tone={pill.tone} />
      </td>
      <td className="px-3 py-3 font-mono text-[11px] text-[var(--text-muted)] whitespace-nowrap">
        {formatAbsoluteTime(session.startTime)}
      </td>
      <td className="px-3 py-3 font-mono text-[11px] text-[var(--text-muted)] whitespace-nowrap text-right">
        {humanDuration(sessionDurationMs(session))}
      </td>
      <td className="px-3 py-3 text-right">
        <ChevronRight className="inline h-4 w-4 text-[var(--text-dim)] group-hover:text-[var(--text)]" />
      </td>
    </tr>
  );
};
