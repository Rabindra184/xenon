import * as React from 'react';
import { Copy, MoreHorizontal } from 'lucide-react';
import { IDevice } from '../../../interfaces/IDevice';
import XenonApiService from '../../../api-service';
import { useAuth } from '../../../auth/auth-context';
import { Button } from '../../ui/button';
import { Select } from '../../ui/select';
import { Popover } from '../../ui/Popover';
import { Menu, MenuDivider, MenuItem } from '../../ui/Menu';
import ReservationModal from '../../reservation-modal/reservation-modal';
import TagManagerModal from '../../tag-manager-modal/tag-manager-modal';
import { useToast } from '../../ui/toast';
import { formatAppiumServerUrl, formatSessionCapabilitiesJson } from './sessionConnection';
import { deviceNetworkIp } from './formatDeviceNetworkAddress';
import { activityLabel, controlAvailability, deviceState, type DeviceState } from './deviceState';

export interface DeviceActionsState {
  kind: DeviceState;
  reserved: boolean;
  activity: string | null;
  control: { enabled: true } | { enabled: false; reason: string };
  isAdmin: boolean;
  editingTeam: boolean;
  setEditingTeam: (v: boolean) => void;
  openReservation: () => void;
  openTagManager: () => void;
  release: () => Promise<void>;
  toggleMaintenance: () => Promise<void>;
  copy: (text: string, successMsg: string) => Promise<void>;
  serverUrl: string;
  ip: string | null;
  /** The reservation and tag dialogs, when open. Rendered at the end of the card. */
  dialogs: React.ReactNode;
}

/**
 * Admin-only team picker, opened from the ⋯ menu. PUTs
 * /xenon/api/grid/device/:udid/team; `onDone(true)` after a change.
 */
export const TeamPicker: React.FC<{
  udid: string;
  currentTeamId: string | null;
  teams: Map<string, string>;
  onDone: (changed: boolean) => void;
}> = ({ udid, currentTeamId, teams, onDone }) => {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  async function pick(teamId: string | null) {
    setBusy(true);
    try {
      await XenonApiService.setDeviceTeam(udid, teamId);
      toast(teamId ? 'Device assigned' : 'Device returned to shared pool', 'success');
      onDone(true);
    } catch (e: any) {
      // 403s are surfaced as a toast by the api-client.
      toast(e?.message || 'Failed to update team', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Select
      selectSize="sm"
      autoFocus
      aria-label="Team"
      disabled={busy}
      defaultValue={currentTeamId ?? ''}
      onBlur={() => onDone(false)}
      onChange={(e) => pick(e.target.value || null)}
    >
      <option value="">(Shared pool)</option>
      {Array.from(teams.entries()).map(([id, name]) => (
        <option key={id} value={id}>
          {name}
        </option>
      ))}
    </Select>
  );
};

/**
 * Shared state and effects behind a device's actions: Control, Reserve/
 * Release, the ⋯ menu and its dialogs. Used by both the card and the table
 * row so the two surfaces stay behaviourally identical.
 */
export function useDeviceActions(device: IDevice, reloadDevices: () => void): DeviceActionsState {
  const [showReservation, setShowReservation] = React.useState(false);
  const [showTagManager, setShowTagManager] = React.useState(false);
  const [editingTeam, setEditingTeam] = React.useState(false);
  const { me } = useAuth();
  const { toast } = useToast();
  // Tags, maintenance and teams are admin-only routes on the server.
  const isAdmin = me?.role === 'ADMIN' || me?.role === 'SUPER_ADMIN';

  const now = Date.now();
  const kind = deviceState(device, now);
  const reserved = kind === 'reserved';
  const activity = activityLabel(device, me, now);
  const control = controlAvailability(device, me);

  const serverUrl = formatAppiumServerUrl(device.host);
  const ip = deviceNetworkIp(device);

  const copy = async (text: string, successMsg: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      toast(successMsg, 'success');
    } catch {
      toast('Failed to copy', 'error');
    }
  };

  const release = async () => {
    await XenonApiService.releaseReservation(device.udid, device.host);
    reloadDevices();
  };
  const block = async () => {
    await XenonApiService.blockDevice(device.udid, device.host);
    reloadDevices();
  };
  const unblock = async () => {
    await XenonApiService.unblockDevice(device.udid, device.host);
    reloadDevices();
  };
  const toggleMaintenance = async () => {
    if (device.userBlocked) await unblock();
    else await block();
  };

  const dialogs = (
    <>
      {showReservation && (
        <ReservationModal
          device={device}
          onClose={() => setShowReservation(false)}
          onReserved={() => reloadDevices()}
        />
      )}
      {showTagManager && (
        <TagManagerModal
          device={device}
          onClose={() => setShowTagManager(false)}
          onUpdated={() => reloadDevices()}
        />
      )}
    </>
  );

  return {
    kind,
    reserved,
    activity,
    control,
    isAdmin,
    editingTeam,
    setEditingTeam,
    openReservation: () => setShowReservation(true),
    openTagManager: () => setShowTagManager(true),
    release,
    toggleMaintenance,
    copy,
    serverUrl,
    ip,
    dialogs,
  };
}

/** Control, then Release or Reserve — identical classes, variants and sizes as the card. */
export const DeviceControlButtons: React.FC<{
  device: IDevice;
  actions: DeviceActionsState;
  navigate: (path: string) => void;
  reasonId?: string;
}> = ({ device, actions, navigate, reasonId }) => {
  const { kind, reserved, control } = actions;
  return (
    <>
      <Button
        variant="tonal"
        size="sm"
        disabled={!control.enabled}
        aria-describedby={control.enabled ? undefined : reasonId}
        onClick={() => {
          if (!control.enabled) return;
          navigate(`/devices/${device.udid}/control`);
        }}
      >
        Control
      </Button>
      {reserved ? (
        <Button variant="secondary" size="sm" onClick={actions.release}>
          Release
        </Button>
      ) : kind === 'ready' ? (
        <Button variant="secondary" size="sm" onClick={actions.openReservation}>
          Reserve
        </Button>
      ) : null}
    </>
  );
};

/** The ⋯ trigger and its Popover + Menu: copy actions for everyone, admin actions for admins. */
export const DeviceMoreMenu: React.FC<{
  device: IDevice;
  actions: DeviceActionsState;
  triggerClassName?: string;
}> = ({ device, actions, triggerClassName }) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const { isAdmin, serverUrl, ip, copy } = actions;

  return (
    <>
      <button
        ref={moreRef}
        type="button"
        className={triggerClassName ?? 'dc2-more'}
        onClick={() => setMenuOpen((o) => !o)}
        aria-label="More actions"
      >
        <MoreHorizontal size={14} />
      </button>
      <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={moreRef}>
        {/* The device's IDs and addresses live here, not on the card face. */}
        <Menu>
          <MenuItem
            icon={<Copy size={12} />}
            onClick={() => {
              setMenuOpen(false);
              copy(device.udid, 'UDID copied');
            }}
          >
            Copy UDID
          </MenuItem>
          {serverUrl !== '—' && (
            <MenuItem
              icon={<Copy size={12} />}
              onClick={() => {
                setMenuOpen(false);
                copy(serverUrl, 'Server URL copied');
              }}
            >
              Copy server URL
            </MenuItem>
          )}
          {ip && (
            <MenuItem
              icon={<Copy size={12} />}
              onClick={() => {
                setMenuOpen(false);
                copy(ip, 'IP address copied');
              }}
            >
              Copy IP address
            </MenuItem>
          )}
          <MenuItem
            icon={<Copy size={12} />}
            onClick={() => {
              setMenuOpen(false);
              copy(formatSessionCapabilitiesJson(device), 'Session capabilities copied');
            }}
          >
            Copy capabilities
          </MenuItem>
          {isAdmin && (
            <>
              <MenuDivider />
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  actions.openTagManager();
                }}
              >
                Manage tags…
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  actions.setEditingTeam(true);
                }}
              >
                Assign team…
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  actions.toggleMaintenance();
                }}
              >
                {device.userBlocked ? 'Exit maintenance' : 'Enter maintenance'}
              </MenuItem>
            </>
          )}
        </Menu>
      </Popover>
    </>
  );
};
