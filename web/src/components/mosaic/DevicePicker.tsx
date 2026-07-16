import * as React from 'react';

export interface PickerDevice {
  udid: string;
  name?: string;
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
}

function reasonLabel(r?: string): string | null {
  switch (r) {
    case 'automation':
      return 'In automation';
    case 'manual_other':
      return 'Manual control by another user';
    case 'manual_self':
      return 'In your mosaic';
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

function platformBadge(p?: string): string {
  if (!p) return '';
  if (p === 'androidtv' || p === 'android-tv') return 'ANDROID TV';
  return p.toUpperCase();
}

export function DevicePicker({ devices, inMosaic, onToggle }: Props) {
  const [filter, setFilter] = React.useState('');
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter(
      (d) =>
        d.udid.toLowerCase().includes(q) ||
        (d.name ?? '').toLowerCase().includes(q) ||
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
    return (
      <div className="text-xs text-[var(--text-dim)] p-3">No devices online.</div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <span
          aria-hidden
          className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-dim)] text-xs"
        >
          ⌕
        </span>
        <input
          type="text"
          value={filter}
          placeholder="Filter devices..."
          onChange={(e) => setFilter(e.target.value)}
          className="w-full pl-7 pr-2 py-1.5 text-xs rounded border border-[var(--border)] bg-transparent placeholder:text-[var(--text-dim)] focus:outline-none focus:border-[var(--accent,#3b82f6)]"
        />
      </div>

      {groups.map((g) => {
        const isCollapsed = collapsed[g.id];
        return (
          <section key={g.id} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
              className="flex items-center justify-between w-full text-[10px] uppercase tracking-wider text-[var(--text-dim)] hover:text-white px-1 py-0.5"
            >
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`inline-block transition-transform ${
                    isCollapsed ? '-rotate-90' : 'rotate-0'
                  }`}
                >
                  ▾
                </span>
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
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left border transition-colors ${
                          blocked
                            ? 'opacity-60 cursor-not-allowed border-transparent'
                            : inMos
                              ? 'border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10'
                              : 'border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-2,rgba(255,255,255,0.04))]'
                        }`}
                        title={
                          blocked
                            ? `${reason} — release first`
                            : inMos
                              ? 'Click to remove from mosaic (or drag to a cell)'
                              : 'Click to add to mosaic (or drag to a cell)'
                        }
                      >
                        {/* Selection toggle (●/○) */}
                        <span
                          aria-hidden
                          className={`inline-flex items-center justify-center w-4 h-4 text-xs ${
                            inMos ? 'text-emerald-400' : 'text-[var(--text-dim)]'
                          }`}
                        >
                          {inMos ? '●' : '○'}
                        </span>
                        {/* Online status dot */}
                        <span
                          aria-hidden
                          className={`inline-block w-1.5 h-1.5 rounded-full ${
                            d.offline
                              ? 'bg-zinc-600'
                              : online
                                ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.7)]'
                                : 'bg-yellow-500'
                          }`}
                        />
                        <span className="font-medium flex-1 truncate text-[13px]">
                          {d.name ?? d.udid}
                        </span>
                        {d.platform && (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--surface-2,rgba(255,255,255,0.06))] text-[var(--text-dim)]">
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
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> available
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" /> in use
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 inline-block" /> offline
        </span>
      </div>
    </div>
  );
}
