import React, { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MonitorPlay } from 'lucide-react';
import { useBuildsData } from './use-builds-data';
import { BuildListRail, type TimeFilter } from './build-list-rail';
import { BuildFilterBar } from './build-filter-bar';
import { BuildsHeader } from './builds-header';
import { SessionTable } from './session-table';
import { buildStatusCounts, type StatusKey } from './derive';
import type { ISession } from '../../interfaces/ISession';
import { useToast } from '../ui/toast';
import XenonApiService from '../../api-service';
import { PageHeader } from '../ui/page-header';

export const BuildsPage: React.FC = () => {
  const navigate = useNavigate();
  const { buildId: routeBuildId } = useParams<{ buildId?: string }>();
  const data = useBuildsData();
  const { toast } = useToast();

  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusKey>('all');
  const [sessionSearch, setSessionSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (routeBuildId && routeBuildId !== data.selectedBuildId) {
      data.selectBuild(routeBuildId);
      setSelectedIds(new Set());
    }
  }, [routeBuildId, data]);

  const handleSelectBuild = (id: string) => navigate(`/builds/${id}`);

  const handleOpenRow = (s: ISession) =>
    navigate(`/builds/${data.selectedBuildId}/sessions/${s.id}`);

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

  const selectedBuild = data.builds.find((b) => b.id === data.selectedBuildId) || null;
  const counts = buildStatusCounts(data.sessions);

  const onRetryFailed = () => {
    toast('Bulk retry lands in a future release.', 'info');
  };

  const onExport = async (fmt: 'json' | 'csv') => {
    if (!data.selectedBuildId) return;
    try {
      const ids = selectedIds.size > 0 ? Array.from(selectedIds) : undefined;
      const { blob, filename } = await XenonApiService.exportBuild(
        data.selectedBuildId,
        fmt,
        ids,
      );
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

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={MonitorPlay}
        title="Sessions"
        subtitle="Builds and the test sessions recorded against them."
      />
      <div className="flex flex-1 min-h-0">
        <BuildListRail
          builds={data.builds}
          selectedBuildId={data.selectedBuildId}
          onSelect={handleSelectBuild}
          search={data.searchQuery}
          onSearchChange={data.setSearchQuery}
          timeFilter={timeFilter}
          onTimeFilterChange={setTimeFilter}
        />

        <section className="flex-1 flex flex-col min-w-0">
          {!selectedBuild ? (
            <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-dim)]">
              Select a build from the left to see its sessions.
            </div>
          ) : (
            <>
              <BuildsHeader
                build={selectedBuild}
                failedCount={counts.failed}
                selectedCount={selectedIds.size}
                onRetryFailed={onRetryFailed}
                onExport={onExport}
              />
              <BuildFilterBar
                sessions={data.sessions}
                active={statusFilter}
                onChange={setStatusFilter}
                search={sessionSearch}
                onSearchChange={setSessionSearch}
                totalMatching={data.sessions.length}
                totalUnfiltered={data.sessions.length}
              />
              <SessionTable
                sessions={data.sessions}
                statusFilter={statusFilter}
                searchQuery={sessionSearch}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onOpenRow={handleOpenRow}
                buildHasNoSessions={data.sessions.length === 0}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default BuildsPage;
