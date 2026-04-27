import * as React from 'react';

export interface PickerDevice {
  udid: string;
  name?: string;
  platform?: string;
  busy?: boolean;
  // Computed from device.session_id by the page; we only render the label here.
  busyReason?: 'automation' | 'manual_other' | 'recording_other_group' | string;
  mjpegServerPort?: number;
}

interface Props {
  devices: PickerDevice[];
  selected: Set<string>;
  onToggle: (udid: string) => void;
}

function reasonLabel(r?: string): string | null {
  switch (r) {
    case 'automation':
      return 'In automation';
    case 'manual_other':
      return 'Manual control by another user';
    case 'recording_other_group':
      return 'Recording in another group';
    default:
      return r ? 'Busy' : null;
  }
}

export function DevicePicker({ devices, selected, onToggle }: Props) {
  if (devices.length === 0) {
    return (
      <div className="text-xs text-[var(--text-dim)] p-3">No devices online.</div>
    );
  }
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {devices.map((d) => {
        const blocked = !!d.busy;
        const reason = reasonLabel(d.busyReason);
        return (
          <li key={d.udid}>
            <label
              className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer border border-transparent hover:border-[var(--border)] ${
                blocked ? 'opacity-60 cursor-not-allowed' : ''
              }`}
              title={blocked ? `${reason} — release first` : undefined}
            >
              <input
                type="checkbox"
                disabled={blocked}
                checked={selected.has(d.udid)}
                onChange={() => onToggle(d.udid)}
              />
              <span className="font-medium">{d.name ?? d.udid}</span>
              <span className="text-[var(--text-dim)] text-xs">{d.platform}</span>
              {blocked && reason && (
                <span className="ml-auto text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--surface-2,rgba(0,0,0,0.05))] text-[var(--text-dim)]">
                  {reason}
                </span>
              )}
            </label>
          </li>
        );
      })}
    </ul>
  );
}
