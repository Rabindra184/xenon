import * as React from 'react';
import { Plus } from 'lucide-react';
import { useOverviewData } from './use-overview-data';
import { KpiCard, type KpiState } from './kpi-card';
import { FleetStatus } from './fleet-status';
import { RecentActivity } from './recent-activity';
import { SessionTrend } from './session-trend';
import { DeviceBreakdown } from './device-breakdown';

const EM_DASH = '—';
const TENANT_NAME = 'Xenon';

const Overview: React.FC = () => {
  const data = useOverviewData();
  const totalDevices = data.devices.length;
  const onlineDevices = data.devices.filter((d) => !d.offline).length;
  const uptimePct = totalDevices ? Math.round((onlineDevices / totalDevices) * 100) : null;

  const devicesState: KpiState =
    totalDevices === 0 ? 'neutral' : onlineDevices === totalDevices ? 'healthy' : 'warn';
  const sessionsState: KpiState =
    data.activeSessions.length > 0 ? 'healthy' : data.queuedSessions > 0 ? 'warn' : 'neutral';
  const failuresState: KpiState = data.failures24h > 0 ? 'critical' : 'healthy';

  const startSession = () => window.dispatchEvent(new CustomEvent('xenon.open-command-palette'));

  const year = new Date().getFullYear();

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[var(--text-dim)] mb-1.5">
              <span>{TENANT_NAME}</span>
              <span>/</span>
              <span className="text-[var(--text-muted)]">Overview</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">
              {TENANT_NAME} <span className="text-[var(--text-dim)]">·</span> Overview
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Real-time fleet health and session activity.
            </p>
          </div>
          <button
            type="button"
            onClick={startSession}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-[var(--green)] hover:bg-[var(--green-dim)] text-black text-sm font-medium transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            New session
          </button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <KpiCard
            label="Devices online"
            value={totalDevices === 0 ? EM_DASH : onlineDevices}
            secondaryValue={totalDevices === 0 ? undefined : totalDevices}
            subtitle={
              totalDevices === 0
                ? 'No devices registered'
                : uptimePct === 100
                ? '100% fleet uptime'
                : `${uptimePct}% fleet uptime`
            }
            state={devicesState}
          />
          <KpiCard
            label="Active sessions"
            value={data.activeSessions.length}
            subtitle={data.queuedSessions > 0 ? `${data.queuedSessions} queued` : 'No queue'}
            state={sessionsState}
          />
          <KpiCard
            label="Heals today"
            value={data.healsToday === null ? EM_DASH : data.healsToday}
            subtitle={
              data.healsToday === null
                ? 'Loading…'
                : data.healsToday === 0
                ? 'No heals needed'
                : `${data.healsToday} selector${data.healsToday === 1 ? '' : 's'} recovered`
            }
            state={data.healsToday && data.healsToday > 0 ? 'warn' : 'neutral'}
          />
          <KpiCard
            label="Failures (24h)"
            value={data.failures24h}
            subtitle={data.failures24h === 0 ? 'No failures' : `${data.failures24h} session${data.failures24h === 1 ? '' : 's'} failed`}
            state={failuresState}
          />
        </div>

        {/* Row 1: Fleet status + Recent activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
          <FleetStatus devices={data.devices} />
          <RecentActivity events={data.activity} live />
        </div>

        {/* Row 2: Session trend + Fleet composition */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2">
            <SessionTrend
              data={data.sessionTrend}
              totalSessions={data.totalSessions24h}
              totalHeals={data.healsToday ?? 0}
            />
          </div>
          <DeviceBreakdown rows={data.osBreakdown} />
        </div>

        <footer className="mt-10 pt-6 border-t border-[var(--border)] flex items-center justify-between text-[11px] font-mono text-[var(--text-dim)]">
          <span>XENON Device Ops · v{__XENON_VERSION__}</span>
          <span>© {year} {TENANT_NAME}</span>
        </footer>
      </div>
    </div>
  );
};

export default Overview;
