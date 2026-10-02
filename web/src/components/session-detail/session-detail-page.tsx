import React, { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBuildsData } from '../builds/use-builds-data';
import { useSessionDetail } from './use-session-detail';
import { BreadcrumbHeader } from './breadcrumb-header';
import { OutcomeHeader, sessionStatusView } from './outcome-header';
import { OutcomeTiles } from './outcome-tiles';
import { FailureSummary } from './failure-summary';
import { HealingPanel } from './healing-panel';
import { PerformancePanel } from './performance-panel';
import { RecordingCard } from './recording-card';
import { DetailsCard } from './details-card';
import { CapabilitiesCard } from './capabilities-card';
import { LogViewer } from './log-viewer';
import { NetworkPanel } from './network-panel';
import { humanDuration, sessionDurationMs, buildDisplayName } from '../builds/derive';
import type { CommandLog } from './commands';
import { useToast } from '../ui/toast';

export const SessionDetailPage: React.FC = () => {
  const { buildId = '', sessionId = '' } = useParams<{ buildId: string; sessionId: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();
  // Reuse the builds-data hook so we can resolve the build name from the cached list.
  const builds = useBuildsData();
  const detail = useSessionDetail(sessionId || null);

  const build = useMemo(
    () => builds.builds.find((b) => b.id === buildId) ?? null,
    [builds.builds, buildId],
  );
  const buildName = build ? buildDisplayName(build) : 'Build';

  // Phase 4A: when the underlying GET returns a "not found" payload (the
  // session is on a team-scoped device the caller can't see, or it really
  // doesn't exist) bounce back to /builds with a toast rather than render
  // an error card. Effect runs once notFound transitions true.
  useEffect(() => {
    if (!detail.loading && detail.notFound) {
      toast('Session not available — it may belong to a team you are not on.', 'info');
      navigate('/builds', { replace: true });
    }
  }, [detail.loading, detail.notFound, navigate, toast]);

  if (detail.loading) {
    return <div className="p-6 text-xs text-[var(--text-dim)]">Loading session…</div>;
  }

  if (detail.error || !detail.session) {
    return (
      <div className="p-6 space-y-2">
        <BreadcrumbHeader
          buildId={buildId}
          buildName={build ? buildName : null}
          sessionId={sessionId}
        />
        <div className="mt-6 rounded-md border border-[var(--red)]/30 bg-[var(--surface)] p-4 text-xs text-[var(--red)]">
          {detail.error || 'Session not found.'}
        </div>
      </div>
    );
  }

  const s = detail.session;
  const commands = detail.sessionLogs as CommandLog[];
  const failed = sessionStatusView(s.status).bucket === 'failed';

  return (
    <div className="flex flex-col h-full min-h-0">
      <BreadcrumbHeader buildId={buildId} buildName={build ? buildName : null} sessionId={s.id} />
      <OutcomeHeader session={s} />

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="px-4 py-4 space-y-4">
          <OutcomeTiles session={s} commands={commands} />

          {failed && (
            <FailureSummary
              session={s}
              buildName={buildName}
              buildId={buildId}
              commands={commands}
              durationText={humanDuration(sessionDurationMs(s))}
            />
          )}

          <HealingPanel commands={commands} />

          <PerformancePanel
            sessionId={s.id}
            running={s.status === 'running'}
            hasTrace={!!s.performance_trace}
          />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
            <div className="min-w-0">
              <LogViewer
                sessionLogs={detail.sessionLogs}
                deviceLogs={detail.deviceLogs}
                debugLogs={detail.debugLogs}
                profiling={detail.profiling}
              />
            </div>

            <div className="flex flex-col gap-4 min-w-0">
              <RecordingCard session={s} />
              <DetailsCard session={s} buildName={build ? buildName : null} />
              <CapabilitiesCard session={s} />
            </div>
          </div>

          <NetworkPanel sessionId={s.id} sessionEnded={s.status !== 'running'} />
        </div>
      </div>
    </div>
  );
};

export default SessionDetailPage;
