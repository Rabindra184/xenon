import * as React from 'react';
import { useOverviewData } from './use-overview-data';
import { KpiCard, type KpiState } from './kpi-card';
import { FleetStatus } from './fleet-status';
import { RecentActivity } from './recent-activity';

const EM_DASH = '—';

const Overview: React.FC = () => {
  const data = useOverviewData();
  const totalDevices = data.devices.length;
  const onlineDevices = data.devices.filter((d) => !d.offline).length;

  const devicesState: KpiState =
    totalDevices === 0 ? 'neutral' : onlineDevices === totalDevices ? 'healthy' : 'warn';
  const sessionsState: KpiState =
    data.activeSessions.length > 0 ? 'healthy' : data.queuedSessions > 0 ? 'warn' : 'neutral';

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Overview</h1>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <KpiCard
            label="Devices online"
            value={totalDevices === 0 ? EM_DASH : onlineDevices}
            secondaryValue={totalDevices === 0 ? undefined : totalDevices}
            subtitle={
              totalDevices === 0
                ? 'No devices registered'
                : `${onlineDevices} of ${totalDevices} online`
            }
            state={devicesState}
          />
          <KpiCard
            label="Active sessions"
            value={data.activeSessions.length}
            subtitle={data.queuedSessions > 0 ? `${data.queuedSessions} queued` : 'No queue'}
            state={sessionsState}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <FleetStatus devices={data.devices} />
          <RecentActivity events={data.activity} live />
        </div>
      </div>
    </div>
  );
};

export default Overview;
