import React from 'react';
import { Copy, Download } from 'lucide-react';
import type { ISession } from '../../interfaces/ISession';
import XenonApiService from '../../api-service';
import { useToast } from '../ui/toast';
import { formatAbsoluteTime, platformLabel, ranOnLabel } from '../builds/derive';

interface Props {
  session: ISession;
  /** The session's build as the Sessions page names it; null when unknown. */
  buildName: string | null;
}

const Row: React.FC<{
  label: string;
  children: React.ReactNode;
  title?: string;
  mono?: boolean;
}> = ({ label, children, title, mono }) => (
  <div className="flex items-baseline justify-between gap-3 px-3 py-2">
    <dt className="text-xs text-[var(--text-muted)] shrink-0">{label}</dt>
    <dd
      className={`text-xs text-[var(--text)] text-right min-w-0 break-all ${mono ? 'font-mono text-[11px]' : ''}`}
      title={title}
    >
      {children}
    </dd>
  </div>
);

/** What the session ran on and for whom, with its ids and files. */
export const DetailsCard: React.FC<Props> = ({ session, buildName }) => {
  const { toast } = useToast();
  const where = ranOnLabel(session.ranOn);
  const traceUrl = session.performance_trace
    ? XenonApiService.getAssetUrl(session.performance_trace)
    : '';

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(session.id);
      toast('Session ID copied', 'success');
    } catch {
      toast('Clipboard unavailable', 'error');
    }
  };

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <header className="px-3 py-2 border-b border-[var(--border)]">
        <h2 className="text-[11px] font-semibold text-[var(--text-dim)]">Details</h2>
      </header>
      <dl className="divide-y divide-[var(--border)]">
        <Row label="Session ID" mono>
          <span className="inline-flex items-center gap-1">
            <span>{session.id}</span>
            <button
              type="button"
              onClick={copyId}
              aria-label="Copy session ID"
              className="p-0.5 rounded text-[var(--text-dim)] hover:text-[var(--text)]"
            >
              <Copy className="h-3 w-3" />
            </button>
          </span>
        </Row>
        {buildName && <Row label="Build">{buildName}</Row>}
        <Row label="Device UDID" mono>
          {session.device_udid || '—'}
        </Row>
        <Row label="Platform">
          {[platformLabel(session), session.device_version]
            .filter((p) => p && p !== '—')
            .join(' ') || '—'}
        </Row>
        <Row label="Ran on" title={session.node_id ? `Node ${session.node_id}` : undefined}>
          {where ?? 'Not known'}
        </Row>
        <Row label="Run by" title={session.owner?.email}>
          {session.owner?.name ?? 'Not recorded'}
        </Row>
        <Row label="Started">{formatAbsoluteTime(session.startTime)}</Row>
        <Row label="Ended">{session.endTime ? formatAbsoluteTime(session.endTime) : '—'}</Row>
        {session.tags && <Row label="Tags">{session.tags}</Row>}
        {traceUrl && (
          <Row label="iOS trace">
            <a
              href={traceUrl}
              className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
            >
              <Download className="h-3 w-3" aria-hidden="true" />
              Performance trace
            </a>
          </Row>
        )}
      </dl>
    </section>
  );
};
