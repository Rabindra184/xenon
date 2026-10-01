import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MonitorPlay, ListChecks } from 'lucide-react';
import { SESSION_LIST_LIMIT, useBuildsData } from './use-builds-data';
import { useSessionSummary } from './use-session-summary';
import { BuildListRail } from './build-list-rail';
import { BuildFilterBar } from './build-filter-bar';
import { BuildsHeader } from './builds-header';
import { SessionTable } from './session-table';
import { SummaryStrip } from './summary-strip';
import {
  buildDisplayName,
  failedTestsReport,
  filterSessions,
  TIME_FILTER_LABEL,
  type StatusKey,
  type TimeFilter,
} from './derive';
import type { ISession } from '../../interfaces/ISession';
import { useToast } from '../ui/toast';
import XenonApiService from '../../api-service';
import { PageHeader } from '../ui/page-header';
import { Select } from '../ui/select';
import { EmptyState } from '../ui/EmptyState';

// The comparison's period in words: "vs prior 7 days".
const PERIOD_WORDS: Record<Exclude<TimeFilter, 'all'>, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

const NAMING_EXAMPLE = `"xe:options": {
  "name": "Checkout happy path",
  "build": "Nightly smoke"
}`;

const NamingHint: React.FC = () => (
  <div className="text-xs text-[var(--text-muted)]">
    <p>Name each test, and group a run, in its capabilities:</p>
    <pre className="mt-2 inline-block rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-left font-mono text-[11px] text-[var(--text)]">
      {NAMING_EXAMPLE}
    </pre>
  </div>
);

export const BuildsPage: React.FC = () => {
  const navigate = useNavigate();
  const { buildId: routeBuildId } = useParams<{ buildId?: string }>();
  const { toast } = useToast();

  const [timeFilter, setTimeFilter] = useState<TimeFilter>('7d');
  const [statusFilter, setStatusFilter] = useState<StatusKey>('all');
  const [sessionSearch, setSessionSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const data = useBuildsData({ withSessions: true, timeFilter });
  const summary = useSessionSummary(timeFilter, data.selectedBuildId);
  const { selectBuild, selectedBuildId } = data;

  // The route decides what is shown: /builds is every session, /builds/:id one build.
  React.useEffect(() => {
    const wanted = routeBuildId ?? null;
    if (wanted !== selectedBuildId) {
      selectBuild(wanted);
      setSelectedIds(new Set());
    }
  }, [routeBuildId, selectedBuildId, selectBuild]);

  const handleSelectBuild = (id: string | null) => navigate(id ? `/builds/${id}` : '/builds');

  const handleOpenRow = (s: ISession) =>
    navigate(`/builds/${encodeURIComponent(s.build_id || 'none')}/sessions/${s.id}`);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const allChecked = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allChecked) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const buildNames = useMemo(
    () => new Map(data.builds.map((b) => [b.id, buildDisplayName(b)])),
    [data.builds],
  );
  const selectedBuild = data.builds.find((b) => b.id === selectedBuildId) || null;

  const failedReport = failedTestsReport(
    selectedBuild ? buildDisplayName(selectedBuild) : 'this build',
    data.sessions,
    selectedIds,
  );

  const onCopyFailed = async () => {
    if (failedReport.count === 0) return;
    try {
      await navigator.clipboard.writeText(failedReport.text);
      toast(
        `Copied ${failedReport.count} failed test${failedReport.count === 1 ? '' : 's'}`,
        'success',
      );
    } catch {
      toast('Clipboard unavailable', 'error');
    }
  };

  const onExport = async (fmt: 'json' | 'csv') => {
    if (!selectedBuildId) return;
    try {
      const ids = selectedIds.size > 0 ? Array.from(selectedIds) : undefined;
      const { blob, filename } = await XenonApiService.exportBuild(selectedBuildId, fmt, ids);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const n = ids ? ids.length : 'all';
      toast(`Exported ${n} session${n === 1 ? '' : 's'} as ${fmt.toUpperCase()}.`, 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(`Export failed: ${msg}`, 'error');
    }
  };

  const allMode = selectedBuildId === null;
  const periodWords = allMode && timeFilter !== 'all' ? PERIOD_WORDS[timeFilter] : null;
  const missingBuild = !allMode && !selectedBuild && !data.loading;

  const filterBar = (
    <BuildFilterBar
      sessions={data.sessions}
      active={statusFilter}
      onChange={setStatusFilter}
      search={sessionSearch}
      onSearchChange={setSessionSearch}
      totalMatching={filterSessions(data.sessions, statusFilter, sessionSearch).length}
      totalUnfiltered={data.sessions.length}
      capped={data.sessions.length >= SESSION_LIST_LIMIT}
    />
  );

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={MonitorPlay}
        title="Sessions"
        subtitle="Every test session, newest first, with its build, device and outcome."
        action={
          <Select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
            selectSize="sm"
            aria-label="Period"
            className="w-40 text-xs"
          >
            {(Object.keys(TIME_FILTER_LABEL) as TimeFilter[]).map((k) => (
              <option key={k} value={k}>
                {TIME_FILTER_LABEL[k]}
              </option>
            ))}
          </Select>
        }
      />
      <SummaryStrip summary={summary} periodLabel={periodWords} />
      <div className="flex flex-1 min-h-0">
        <BuildListRail
          builds={data.builds}
          selectedBuildId={selectedBuildId}
          onSelect={handleSelectBuild}
          timeFilter={timeFilter}
        />

        <section className="flex-1 flex flex-col min-w-0">
          {missingBuild ? (
            <EmptyState
              title="This build isn’t available"
              description="It may have been removed, or belong to a team you’re not on."
            />
          ) : allMode ? (
            <>
              {/* The rail's selected "All sessions" names this view; no header of its own. */}
              <h2 className="sr-only">All sessions</h2>
              {filterBar}
              <SessionTable
                sessions={data.sessions}
                statusFilter={statusFilter}
                searchQuery={sessionSearch}
                buildNames={buildNames}
                showBuild
                showSelection={false}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onOpenRow={handleOpenRow}
                empty={
                  data.loading ? null : (
                    <div className="px-6 py-6">
                      <EmptyState
                        icon={<ListChecks className="h-5 w-5" />}
                        title={
                          timeFilter === 'all'
                            ? 'No sessions yet'
                            : `No sessions in the ${TIME_FILTER_LABEL[timeFilter].toLowerCase()}`
                        }
                        description="Sessions appear here as your tests run."
                        action={<NamingHint />}
                      />
                    </div>
                  )
                }
              />
            </>
          ) : selectedBuild ? (
            <>
              <BuildsHeader
                build={selectedBuild}
                failedToCopy={failedReport.count}
                onCopyFailed={onCopyFailed}
                onExport={onExport}
              />
              {filterBar}
              <SessionTable
                sessions={data.sessions}
                statusFilter={statusFilter}
                searchQuery={sessionSearch}
                buildNames={buildNames}
                showBuild={false}
                showSelection
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onOpenRow={handleOpenRow}
                empty={
                  <div className="px-6 py-12 text-center text-xs text-[var(--text-dim)]">
                    No sessions in this build yet. Trigger one from your test runner.
                  </div>
                }
              />
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
};

export default BuildsPage;
