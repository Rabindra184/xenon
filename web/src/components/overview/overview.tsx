import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { Card } from '../ui/Card';
import { KpiTile } from './KpiTile';
import { FleetTable } from './FleetTable';
import { ActivityStream } from './ActivityStream';
import { useOverviewData } from './use-overview-data';
import './overview.css';

const EM_DASH = '—';

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return EM_DASH;
  return `${Math.round(n)}%`;
}

const Overview: React.FC = () => {
  const navigate = useNavigate();
  const data = useOverviewData();
  const online = data.devices.filter((d) => !d.offline).length;
  const total = data.devices.length;
  const uptimePct = total ? (online / total) * 100 : NaN;

  return (
    <div className="ov">
      <div className="ov-header">
        <div>
          <div className="ov-crumb">Workspace</div>
          <h1 className="ov-title">Overview</h1>
        </div>
        <div className="ov-actions">
          <Button variant="primary" onClick={() => navigate('/builds')}>
            + New session
          </Button>
        </div>
      </div>

      <div className="ov-kpis">
        <KpiTile
          label="Devices online"
          value={
            <>
              <span>{online}</span>
              <span className="ov-kpi-total">/ {total}</span>
            </>
          }
          subline={total ? `● ${fmtPct(uptimePct)} fleet uptime` : 'No devices connected'}
          tone="ready"
        />
        <KpiTile
          label="Active sessions"
          value={data.activeSessions.length}
          subline={data.queuedSessions ? `▸ ${data.queuedSessions} queued` : 'No queue'}
          tone={data.queuedSessions ? 'busy' : 'neutral'}
        />
        <KpiTile
          label="Heals today"
          value={data.healsToday ?? EM_DASH}
          subline={EM_DASH}
          tone="neutral"
        />
        <KpiTile
          label="Failures (24h)"
          value={data.failures24h}
          subline={data.failures24h === 0 ? 'No failures' : '24h rolling window'}
          tone={data.failures24h > 0 ? 'error' : 'neutral'}
        />
      </div>

      <div className="ov-grid">
        <Card
          header="Fleet status"
          action={
            <a
              href="/devices"
              onClick={(e) => {
                e.preventDefault();
                navigate('/devices');
              }}
            >
              View all →
            </a>
          }
          padded={false}
        >
          <FleetTable devices={data.devices} />
        </Card>
        <Card header="Recent activity" padded={false}>
          <ActivityStream events={data.activity} />
        </Card>
      </div>
    </div>
  );
};

export default Overview;
