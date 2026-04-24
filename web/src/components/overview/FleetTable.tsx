import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { IDevice } from '../../interfaces/IDevice';
import { StatusDot, StatusKind } from '../ui/StatusDot';
import { StatusCode } from '../ui/StatusCode';

export function kindOfDevice(d: IDevice): StatusKind {
  if (d.offline) return 'offline';
  if (d.userBlocked) return 'error';
  if (d.busy) return 'busy';
  if (d.reservedUntil && Date.now() < d.reservedUntil) return 'reserved';
  return 'ready';
}

const PRIORITY: Record<StatusKind, number> = {
  busy: 0,
  reserved: 1,
  ready: 2,
  error: 3,
  offline: 4,
};

export const FleetTable: React.FC<{ devices: IDevice[]; limit?: number }> = ({
  devices,
  limit = 6,
}) => {
  const navigate = useNavigate();
  const sorted = [...devices].sort((a, b) => PRIORITY[kindOfDevice(a)] - PRIORITY[kindOfDevice(b)]);
  const shown = sorted.slice(0, limit);

  if (shown.length === 0) {
    return <div className="ov-fleet-empty">No devices connected.</div>;
  }

  return (
    <div className="ov-fleet">
      {shown.map((d) => {
        const k = kindOfDevice(d);
        return (
          <div
            key={`${d.host}|${d.udid}`}
            className="ov-fleet-row"
            onClick={() => navigate(`/devices/${d.udid}/control`)}
          >
            <StatusDot kind={k} />
            <span className="ov-fleet-name" title={d.name}>
              {d.name}
            </span>
            <span className="ov-fleet-udid" title={d.udid}>
              {d.udid.length > 18 ? `${d.udid.slice(0, 10)}…${d.udid.slice(-4)}` : d.udid}
            </span>
            <StatusCode kind={k}>{k}</StatusCode>
          </div>
        );
      })}
    </div>
  );
};
