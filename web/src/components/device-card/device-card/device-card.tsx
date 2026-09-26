import * as React from 'react';
import { Copy, MoreHorizontal, Smartphone, Tablet, Tv } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IDevice } from '../../../interfaces/IDevice';
import XenonApiService from '../../../api-service';
import { useAuth } from '../../../auth/auth-context';
import { Button } from '../../ui/button';
import { Select } from '../../ui/select';
import { Pill } from '../../ui/Pill';
import { Popover } from '../../ui/Popover';
import { Menu, MenuDivider, MenuItem } from '../../ui/Menu';
import ReservationModal from '../../reservation-modal/reservation-modal';
import TagManagerModal from '../../tag-manager-modal/tag-manager-modal';
import { HealthBadges } from '../health-badges';
import { useToast } from '../../ui/toast';
import { formatAppiumServerUrl, formatSessionCapabilitiesJson } from './sessionConnection';
import { deviceNetworkIp } from './formatDeviceNetworkAddress';
import './device-card.css';
import { activityLabel, controlAvailability, deviceState, type DeviceState } from './deviceState';
import { deviceFormFactor, deviceSubtitle, deviceTitle } from './deviceIdentity';

interface Props {
  device: IDevice;
  reloadDevices: () => void;
  navigate: (path: string) => void;
  /**
   * Map of team-id -> team-name. Prefetched once at the explorer level so
   * every card can resolve its `device.teamId` without firing its own
   * /xenon/api/teams request. Defaults to an empty map; falls back to a
   * "Team {id-prefix}" string if a lookup misses.
   */
  teams?: Map<string, string>;
}

const STATE_LABEL: Record<DeviceState, string> = {
  ready: 'Ready',
  busy: 'Busy',
  reserved: 'Reserved',
  maintenance: 'Maintenance',
  offline: 'Offline',
};

/** Phone, tablet or TV outline; dashed for emulators and simulators. */
const FormFactorIcon: React.FC<{ device: IDevice }> = ({ device }) => {
  const Icon = { phone: Smartphone, tablet: Tablet, tv: Tv }[deviceFormFactor(device)];
  const virtual = device.deviceType === 'emulator' || device.deviceType === 'simulator';
  return <Icon size={26} strokeWidth={1.5} strokeDasharray={virtual ? '3 2' : undefined} />;
};

/**
 * Admin-only team picker, opened from the ⋯ menu. PUTs
 * /xenon/api/grid/device/:udid/team; `onDone(true)` after a change.
 */
const TeamPicker: React.FC<{
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

export const DeviceCard: React.FC<Props> = ({ device, reloadDevices, navigate, teams }) => {
  const [showReservation, setShowReservation] = React.useState(false);
  const [showTagManager, setShowTagManager] = React.useState(false);
  const [editingTeam, setEditingTeam] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const { me } = useAuth();
  const { toast } = useToast();
  // Tags, maintenance and teams are admin-only routes on the server.
  const isAdmin = me?.role === 'ADMIN' || me?.role === 'SUPER_ADMIN';

  const now = Date.now();
  const kind = deviceState(device, now);
  const reserved = kind === 'reserved';
  const activity = activityLabel(device, me, now);
  const control = controlAvailability(device, me);
  const reasonId = `dc2-reason-${device.udid}`;
  const title = deviceTitle(device);
  const teamName = device.teamId
    ? (teams?.get(device.teamId) ?? device.teamName ?? `Team ${device.teamId.slice(0, 6)}`)
    : null;

  const serverUrl = formatAppiumServerUrl(device.host);
  const ip = deviceNetworkIp(device);

  const copyText = async (text: string, successMsg: string) => {
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

  return (
    <div className={`dc2 dc2-${kind}`}>
      {/* The state first: what you need to know before anything else. */}
      <div className={`dc2-band dc2-band-${kind}`}>
        <span className="dc2-band-label">
          <span className="dc2-band-dot" aria-hidden />
          {STATE_LABEL[kind]}
        </span>
        {activity && (
          <span className="dc2-band-activity" title={activity}>
            {activity}
          </span>
        )}
      </div>

      <div className={`dc2-body${kind === 'offline' ? ' dc2-dim' : ''}`}>
        <div className="dc2-head">
          <div className="dc2-icon" aria-hidden>
            <FormFactorIcon device={device} />
          </div>
          <div className="dc2-id">
            <div className="dc2-title" title={`${title}\n${device.udid}`}>
              {title}
            </div>
            <div className="dc2-subtitle">{deviceSubtitle(device)}</div>
          </div>
        </div>
        <div className="dc2-meta">
          <HealthBadges device={device} />
          {editingTeam ? (
            <TeamPicker
              udid={device.udid}
              currentTeamId={device.teamId ?? null}
              teams={teams ?? new Map()}
              onDone={(changed) => {
                setEditingTeam(false);
                if (changed) reloadDevices();
              }}
            />
          ) : (
            teamName && (
              <Pill tone="accent" title={`Team: ${teamName}`}>
                {teamName}
              </Pill>
            )
          )}
          {device.tags?.slice(0, 2).map((t) => (
            <span key={t} className="dc2-tag" title={t}>
              #{t}
            </span>
          ))}
          {(device.tags?.length || 0) > 2 && (
            <span className="dc2-tag">+{(device.tags?.length || 0) - 2}</span>
          )}
        </div>
      </div>

      <div className="dc2-foot">
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
          <Button variant="secondary" size="sm" onClick={release}>
            Release
          </Button>
        ) : kind === 'ready' ? (
          <Button variant="secondary" size="sm" onClick={() => setShowReservation(true)}>
            Reserve
          </Button>
        ) : null}
        {/* Said on the card, not only in a tooltip: a disabled button gave no
            reason unless you hovered it. */}
        {!control.enabled && (
          <span id={reasonId} className="dc2-unavailable" title={control.reason}>
            {control.reason}
          </span>
        )}
        <span className="dc2-spacer" />
        <button
          ref={moreRef}
          type="button"
          className="dc2-more"
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
                copyText(device.udid, 'UDID copied');
              }}
            >
              Copy UDID
            </MenuItem>
            {serverUrl !== '—' && (
              <MenuItem
                icon={<Copy size={12} />}
                onClick={() => {
                  setMenuOpen(false);
                  copyText(serverUrl, 'Server URL copied');
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
                  copyText(ip, 'IP address copied');
                }}
              >
                Copy IP address
              </MenuItem>
            )}
            <MenuItem
              icon={<Copy size={12} />}
              onClick={() => {
                setMenuOpen(false);
                copyText(formatSessionCapabilitiesJson(device), 'Session capabilities copied');
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
                    setShowTagManager(true);
                  }}
                >
                  Manage tags…
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    setEditingTeam(true);
                  }}
                >
                  Assign team…
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    if (device.userBlocked) unblock();
                    else block();
                  }}
                >
                  {device.userBlocked ? 'Exit maintenance' : 'Enter maintenance'}
                </MenuItem>
              </>
            )}
          </Menu>
        </Popover>
      </div>

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
    </div>
  );
};

export default function DeviceCardWrapper(props: {
  device: IDevice;
  reloadDevices: () => void;
  teams?: Map<string, string>;
}) {
  const navigate = useNavigate();
  return (
    <DeviceCard
      device={props.device}
      reloadDevices={props.reloadDevices}
      navigate={navigate}
      teams={props.teams}
    />
  );
}
