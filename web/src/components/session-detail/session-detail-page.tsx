import React, { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useBuildsData } from '../builds/use-builds-data';
import { useSessionDetail } from './use-session-detail';
import { BreadcrumbHeader } from './breadcrumb-header';
import { MetadataGrid } from './metadata-grid';
import { FailureSummary } from './failure-summary';
import { RecordingCard } from './recording-card';
import { CapabilitiesCard } from './capabilities-card';
import { StatusPillOutline, type StatusTone } from '../ui/status-pill-outline';
import {
  formatAbsoluteTime,
  humanDuration,
  platformLabel,
  sessionDurationMs,
  deviceNameOrFallback,
  osVersionLabel,
} from '../builds/derive';
import { humanizeFailureCategory } from './derive';
import { Copy } from 'lucide-react';
import { useToast } from '../ui/toast';
import type { MetadataRow } from './metadata-card';

function statusTone(status: string | null | undefined): { label: string; tone: StatusTone } {
  if (status === 'running') return { label: 'RUNNING', tone: 'running' };
  if (status === 'failed') return { label: 'FAILED', tone: 'failed' };
  if (status === 'ended' || status === 'passed') return { label: 'PASSED', tone: 'passed' };
  const s = typeof status === 'string' ? status : '';
  return { label: (s || 'UNKNOWN').toUpperCase(), tone: 'offline' };
}

export const SessionDetailPage: React.FC = () => {
  const { buildId = '', sessionId = '' } = useParams<{ buildId: string; sessionId: string }>();
  const { toast } = useToast();
  // Reuse the builds-data hook so we can resolve the build name from the cached list.
  const builds = useBuildsData();
  const detail = useSessionDetail(sessionId || null);

  const buildName = useMemo(() => {
    const match = builds.builds.find((b) => b.id === buildId);
    return match?.name || 'Build';
  }, [builds.builds, buildId]);

  if (detail.loading) {
    return (
      <div className="p-6 text-xs text-[var(--text-dim)]">Loading session…</div>
    );
  }

  if (detail.error || !detail.session) {
    return (
      <div className="p-6 space-y-2">
        <BreadcrumbHeader buildId={buildId} buildName={buildName} sessionId={sessionId} />
        <div className="mt-6 rounded-md border border-[var(--red)]/30 bg-[var(--surface)] p-4 text-xs text-[var(--red)]">
          {detail.error || 'Session not found.'}
        </div>
      </div>
    );
  }

  const s = detail.session;
  const pill = statusTone(s.status);
  const durationText = humanDuration(sessionDurationMs(s));
  const allLogs = [...detail.sessionLogs, ...detail.deviceLogs, ...detail.debugLogs];

  const copySessionIdValue = async () => {
    try {
      await navigator.clipboard.writeText(s.id);
      toast('Session ID copied', 'success');
    } catch {
      toast('Clipboard unavailable', 'error');
    }
  };

  const identityRows: MetadataRow[] = [
    { label: 'Device', value: deviceNameOrFallback(s) },
    { label: 'Node ID', value: s.node_id || '—', mono: true },
    { label: 'Platform', value: platformLabel(s) },
    { label: 'OS Version', value: s.device_version ? osVersionLabel(s) : '—', mono: true },
  ];

  const runRows: MetadataRow[] = [
    {
      label: 'Session ID',
      value: (
        <span className="inline-flex items-center gap-1">
          <span className="truncate" title={s.id}>{s.id}</span>
          <button
            type="button"
            onClick={copySessionIdValue}
            aria-label="Copy session ID"
            className="p-0.5 rounded text-[var(--text-dim)] hover:text-[var(--text)]"
          >
            <Copy className="h-3 w-3" />
          </button>
        </span>
      ),
      mono: true,
    },
    { label: 'Start Time', value: formatAbsoluteTime(s.startTime), mono: true },
    { label: 'Duration', value: durationText, mono: true },
  ];

  const failed = s.status === 'failed';
  const resultRows: MetadataRow[] = [
    {
      label: 'Status',
      value: <StatusPillOutline label={pill.label} tone={pill.tone} />,
    },
  ];
  if (failed && s.failure_category) {
    const cat = humanizeFailureCategory(s.failure_category);
    resultRows.push({
      label: 'Category',
      value: (
        <a
          href={`/xenon/runbooks/${encodeURIComponent(s.failure_category.toLowerCase())}`}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--red)] hover:underline"
        >
          {cat}
        </a>
      ),
    });
  }
  if (failed && s.failure_reason) {
    resultRows.push({
      label: 'Failure Reason',
      value: s.failure_reason,
      tone: 'red',
    });
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <BreadcrumbHeader buildId={buildId} buildName={buildName} sessionId={s.id} />

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 space-y-4">
          <MetadataGrid identity={identityRows} run={runRows} result={resultRows} />

          {failed && (
            <FailureSummary
              session={s}
              buildName={buildName}
              buildId={buildId}
              allLogs={allLogs}
              durationText={durationText}
            />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 min-h-[240px] flex items-center justify-center">
              <span className="text-xs text-[var(--text-dim)]">
                Log viewer lands in Plan 4D ({allLogs.length} log entries ready to render)
              </span>
            </section>

            <div className="flex flex-col gap-4">
              <RecordingCard session={s} />
              <CapabilitiesCard session={s} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SessionDetailPage;
