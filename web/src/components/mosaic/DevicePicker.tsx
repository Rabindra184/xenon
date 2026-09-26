import * as React from 'react';
import { ChevronDown, Circle, CircleCheck, Search } from 'lucide-react';
import { platformLabel } from '../../lib/labels';

export interface PickerDevice {
  udid: string;
  name?: string;
  /** Another name the device goes by (its codename); matched by the filter. */
  altName?: string;
  platform?: string;
  busy?: boolean;
  // Computed from device.session_id by the page; we only render the label here.
  busyReason?:
    | 'automation'
    | 'manual_other'
    | 'manual_self'
    | 'recording_other_group'
    | string;
  mjpegServerPort?: number;
  offline?: boolean;
}

interface Props {
  devices: PickerDevice[];
  /** UDIDs currently in the mosaic (drives the "in" highlight). */
  inMosaic: Set<string>;
  /** Click handler — single click toggles add/remove. */
  onToggle: (udid: string) => void;
  /** Whether the device list has loaded. An empty list only means "none online" once it has. */
  status?: 'loading' | 'ready' | 'error';
}

function reasonLabel(r?: string): string | null {
  switch (r) {
    case 'automation':
      return 'In automation';
    case 'manual_other':
      return 'Manual control by another user';
    case 'manual_self':
      return 'On your grid';
    case 'recording_other_group':
      return 'Recording in another group';
    default:
      return r ? 'Busy' : null;
  }
}

// Map raw platform strings to the human label shown in the group header
// and the platform badge on each row. Order in the returned array dictates
// the on-screen group order.
const GROUP_DEFS: Array<{ id: string; label: string; match: (p: string) => boolean }> = [
  { id: 'ios', label: 'iOS', match: (p) => p === 'ios' },
  { id: 'android', label: 'Android', match: (p) => p === 'android' },
  { id: 'tvos', label: 'tvOS', match: (p) => p === 'tvos' },
  { id: 'androidtv', label: 'Android TV', match: (p) => p === 'androidtv' || p === 'android-tv' },
  { id: 'other', label: 'Other', match: () => true },
];

const STATUS_DOT = {
  available: 'bg-[var(--color-success)]',
  inUse: 'bg-[var(--color-warning)]',
  offline: 'bg-[rgb(var(--rgb-offline))]',
};

const LEGEND: Array<[string, string]> = [
  ['available', STATUS_DOT.available],
  ['in use', STATUS_DOT.inUse],
  ['offline', STATUS_DOT.offline],
];

function platformBadge(p?: string): string {
  return platformLabel(p);
}

export function DevicePicker({ devices, inMosaic, onToggle, status = 'ready' }: Props) {
  const [filter, setFilter] = React.useState('');
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter(
      (d) =>
        d.udid.toLowerCase().includes(q) ||
        (d.name ?? '').toLowerCase().includes(q) ||
        (d.altName ?? '').toLowerCase().includes(q) ||
        (d.platform ?? '').toLowerCase().includes(q),
    );
  }, [devices, filter]);

  const groups = React.useMemo(() => {
    const out: Array<{ id: string; label: string; rows: PickerDevice[] }> = GROUP_DEFS.map(
      (g) => ({ id: g.id, label: g.label, rows: [] as PickerDevice[] }),
    );
    const find = (p: string) =>
      out.find((_, idx) => GROUP_DEFS[idx].match(p)) ?? out[out.length - 1];
    for (const d of filtered) {
      const grp = find((d.platform ?? '').toLowerCase());
      grp.rows.push(d);
    }
    return out.filter((g) => g.rows.length > 0);
  }, [filtered]);

  if (devices.length === 0) {
    const message =
      status === 'loading'
        ? 'Loading devices…'
        : status === 'error'
          ? 'Couldn’t load devices. Retrying…'
          : 'No devices online.';
    return (
      <div role="status" className="text-xs text-[var(--text-dim)] p-3">
        {message}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search
          aria-hidden
          size={12}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-dim)]"
        />
        <input
          type="text"
          value={filter}
          placeholder="Filter devices..."
          onChange={(e) => setFilter(e.target.value)}
          className="w-full pl-7 pr-2 py-1.5 text-xs rounded border border-[var(--border)] bg-transparent placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[var(--color-info)]"
        />
      </div>

      {groups.map((g) => {
        const isCollapsed = collapsed[g.id];
        return (
          <section key={g.id} className="flex flex-col gap-1">
            <button
              type="button"
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
              className="flex items-center justify-between w-full text-[11px] text-[var(--text-dim)] hover:text-[rgb(var(--rgb-fg))] px-1 py-0.5"
            >
              <span className="flex items-center gap-1.5">
                <ChevronDown
                  aria-hidden
                  size={12}
                  className={`transition-transform ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                />
                {g.label}
              </span>
              <span>{g.rows.length}</span>
            </button>
            {!isCollapsed && (
              <ul className="flex flex-col gap-1 text-sm">
                {g.rows.map((d) => {
                  const isSelf = d.busyReason === 'manual_self';
                  const inMos = inMosaic.has(d.udid);
                  const blocked = (!!d.busy && !isSelf && !inMos) || !!d.offline;
                  const reason = d.offline ? 'Offline' : reasonLabel(d.busyReason);
                  // Online status — green when not busy or only self-busy.
                  const online = !blocked;
                  const label = [d.name ?? d.udid, d.platform && platformBadge(d.platform)]
                    .concat(blocked && reason ? [reason] : [])
                    .filter(Boolean)
                    .join(', ');
                  return (
                    <li key={d.udid}>
                      <button
                        type="button"
                        disabled={blocked}
                        draggable={!blocked}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'copy';
                          e.dataTransfer.setData('application/x-xenon-udid', d.udid);
                          e.dataTransfer.setData('text/plain', d.udid);
                        }}
                        onClick={() => onToggle(d.udid)}
                        aria-label={label}
                        aria-pressed={inMos}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left border transition-colors ${
                          blocked
                            ? 'opacity-60 cursor-not-allowed border-transparent'
                            : inMos
                              ? 'border-[rgb(var(--rgb-accent)/0.4)] bg-[rgb(var(--rgb-accent)/0.05)] hover:bg-[rgb(var(--rgb-accent)/0.1)]'
                              : 'border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-2)]'
                        }`}
                        title={
                          blocked
                            ? `${reason} — release first`
                            : inMos
                              ? 'Click to remove from the grid'
                              : 'Click to add to the grid (or drag to a cell)'
                        }
                      >
                        {/* On the grid or not */}
                        {inMos ? (
                          <CircleCheck
                            aria-hidden
                            size={14}
                            className="shrink-0 text-[var(--color-accent-soft)]"
                          />
                        ) : (
                          <Circle
                            aria-hidden
                            size={14}
                            className="shrink-0 text-[var(--text-dim)]"
                          />
                        )}
                        {/* Online status dot */}
                        <span
                          aria-hidden
                          className={`inline-block w-1.5 h-1.5 rounded-full ${
                            d.offline
                              ? STATUS_DOT.offline
                              : online
                                ? STATUS_DOT.available
                                : STATUS_DOT.inUse
                          }`}
                        />
                        <span className="font-medium flex-1 truncate text-[13px]">
                          {d.name ?? d.udid}
                        </span>
                        {d.platform && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-dim)]">
                            {platformBadge(d.platform)}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {filter && groups.length === 0 && (
        <div className="text-xs text-[var(--text-dim)] px-1 py-2">
          No devices match "{filter}".
        </div>
      )}

      <div className="text-[10px] text-[var(--text-dim)] px-1 pt-2 flex items-center gap-3">
        {LEGEND.map(([label, dot]) => (
          <span key={label} className="inline-flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${dot}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
