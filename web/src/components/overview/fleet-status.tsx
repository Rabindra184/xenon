import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Smartphone, Tv, Tablet, Monitor, Filter } from 'lucide-react';
import type { IDevice } from '../../interfaces/IDevice';

interface Props {
  devices: IDevice[];
  /** Hard cap on visible rows. Default 6 to match the reference. */
  maxRows?: number;
}

type DeviceStatus = 'ready' | 'busy' | 'offline' | 'reserved';

function deviceStatus(d: IDevice): DeviceStatus {
  if (d.offline) return 'offline';
  if (d.reservedBy) return 'reserved';
  if (d.busy) return 'busy';
  return 'ready';
}

function deviceIcon(d: IDevice) {
  const p = (d.platform || '').toLowerCase();
  if (p === 'tvos') return Tv;
  // Heuristic: iPad / tablet hint via name
  if (/pad|tablet/i.test(d.name || '')) return Tablet;
  if (p === 'ios' || p === 'android') return Smartphone;
  return Monitor;
}

const statusStyle: Record<DeviceStatus, { dot: string; text: string; label: string }> = {
  ready:    { dot: 'bg-[var(--green)]', text: 'text-[var(--green)]', label: 'READY' },
  busy:     { dot: 'bg-[var(--amber)]', text: 'text-[var(--amber)]', label: 'BUSY' },
  reserved: { dot: 'bg-[var(--blue)]',  text: 'text-[var(--blue)]',  label: 'RESERVED' },
  offline:  { dot: 'bg-[var(--text-dim)]', text: 'text-[var(--text-dim)]', label: 'OFFLINE' },
};

function shortUdid(udid?: string): string {
  if (!udid) return '';
  if (udid.length <= 16) return udid;
  return `${udid.slice(0, 8)}…${udid.slice(-4)}`;
}

export const FleetStatus: React.FC<Props> = ({ devices, maxRows = 6 }) => {
  const [filter, setFilter] = useState<'all' | 'issues'>('all');
  const navigate = useNavigate();

  const visible = (filter === 'all' ? devices : devices.filter((d) => deviceStatus(d) !== 'ready'))
    .slice(0, maxRows);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-[var(--text)]">Fleet status</h2>
          <span className="text-xs font-mono text-[var(--text-dim)]">{devices.length} devices</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-2 py-1 text-[11px] rounded transition-colors ${filter === 'all' ? 'bg-[var(--border-strong)] text-[var(--text)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'}`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilter('issues')}
              className={`px-2 py-1 text-[11px] rounded transition-colors flex items-center gap-1 ${filter === 'issues' ? 'bg-[var(--border-strong)] text-[var(--text)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'}`}
            >
              <Filter className="h-3 w-3" />
              Non-ready
            </button>
          </div>
          <button
            type="button"
            onClick={() => navigate('/devices')}
            className="ml-1 inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            View all <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </header>

      <div className="divide-y divide-[var(--border)]">
        {visible.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-[var(--text-dim)]">
            {filter === 'issues' ? 'All devices are ready.' : 'No devices registered.'}
          </div>
        ) : (
          visible.map((d) => {
            const Icon = deviceIcon(d);
            const status = statusStyle[deviceStatus(d)];
            return (
              <button
                key={d.udid || d.name}
                type="button"
                onClick={() => d.udid && navigate(`/devices/${d.udid}/control/screen`)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface-2)] transition-colors text-left"
              >
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${status.dot}`} />
                <Icon className="h-4 w-4 text-[var(--text-dim)] shrink-0" />
                <div className="flex-1 min-w-0 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-[var(--text)] truncate">{d.name || d.udid}</div>
                  </div>
                  <div className="hidden md:block text-[11px] font-mono text-[var(--text-dim)] w-24 text-right">
                    {(d.platform || '').toUpperCase()} {d.sdk || ''}
                  </div>
                  <div className="hidden lg:block text-[11px] font-mono text-[var(--text-dim)] w-32 text-right">
                    {shortUdid(d.udid)}
                  </div>
                </div>
                <span className={`font-mono text-[10px] font-semibold tracking-wider w-20 text-right ${status.text}`}>
                  {status.label}
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
};
