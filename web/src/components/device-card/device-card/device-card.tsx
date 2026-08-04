import * as React from 'react';
import prettyMilliseconds from 'pretty-ms';
import { Copy, MoreHorizontal, Clock, Terminal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IDevice } from '../../../interfaces/IDevice';
import XenonApiService from '../../../api-service';
import { useAuth } from '../../../auth/auth-context';
import { Button } from '../../ui/button';
import { Select } from '../../ui/select';
import { Pill } from '../../ui/Pill';
import { StatusCode } from '../../ui/StatusCode';
import { StatusKind } from '../../ui/StatusDot';
import { KeyValueRow } from '../../ui/KeyValueRow';
import { Popover } from '../../ui/Popover';
import { Menu, MenuItem } from '../../ui/Menu';
import ReservationModal from '../../reservation-modal/reservation-modal';
import TagManagerModal from '../../tag-manager-modal/tag-manager-modal';
import { HealthBadges } from '../health-badges';
import { useToast } from '../../ui/toast';
import { formatDeviceNetworkAddress } from './formatDeviceNetworkAddress';
import {
  deviceTypeLabel,
  formatAppiumServerUrl,
  formatSessionCapabilitiesJson,
} from './sessionConnection';
import './device-card.css';

const SHARED_POOL_LABEL = 'Shared';
const SHARED_POOL_TITLE = 'Shared pool — visible to all authenticated users';

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

/**
 * Inline team chip on each device card. Read-only for non-admins (Shared or
 * team name). Admins see a click-to-edit `<select>` with all teams plus a
 * shared-pool option. PUTs /xenon/api/grid/device/:udid/team and triggers
 * the parent's `reloadDevices` on success.
 */
const DeviceTeamChip: React.FC<{
  udid: string;
  currentTeamId: string | null;
  resolvedTeamName?: string | null;
  teams: Map<string, string>;
  canEdit: boolean;
  onChanged: () => void;
}> = ({ udid, currentTeamId, resolvedTeamName, teams, canEdit, onChanged }) => {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const teamName = currentTeamId
    ? teams.get(currentTeamId) ??
      resolvedTeamName ??
      `Team ${currentTeamId.slice(0, 6)}`
    : SHARED_POOL_LABEL;

  async function pick(teamId: string | null) {
    setBusy(true);
    try {
      await XenonApiService.setDeviceTeam(udid, teamId);
      toast(
        teamId ? 'Device assigned' : 'Device returned to shared pool',
        'success',
      );
      onChanged();
      setEditing(false);
    } catch (e: any) {
      // 403s are surfaced as a toast by the api-client.
      toast(e?.message || 'Failed to update team', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    if (!currentTeamId) {
      return (
        <Pill tone="neutral" title={SHARED_POOL_TITLE}>
          {SHARED_POOL_LABEL}
        </Pill>
      );
    }
    return (
      <Pill tone="accent" title={`Team: ${teamName}`}>
        {teamName}
      </Pill>
    );
  }

  if (editing) {
    return (
      <Select
        selectSize="sm"
        autoFocus
        disabled={busy}
        defaultValue={currentTeamId ?? ''}
        onBlur={() => setEditing(false)}
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
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="dc2-team-pill"
      title={currentTeamId ? 'Click to change team' : 'Click to assign to a team'}
    >
      {teamName}
    </button>
  );
};

function deriveKind(d: IDevice): StatusKind {
  if (d.offline) return 'offline';
  if (d.userBlocked) return 'error';
  if (d.busy) return 'busy';
  if (d.reservedUntil && Date.now() < d.reservedUntil) return 'reserved';
  return 'ready';
}

function middleEllipsis(s: string, head = 10, tail = 4): string {
  if (!s || s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export const DeviceCard: React.FC<Props> = ({ device, reloadDevices, navigate, teams }) => {
  const [showReservation, setShowReservation] = React.useState(false);
  const [showTagManager, setShowTagManager] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const { me } = useAuth();
  const { toast } = useToast();
  const canEditTeam = me?.role === 'ADMIN' || me?.role === 'SUPER_ADMIN';

  const kind = deriveKind(device);
  const reserved = kind === 'reserved';
  const busyLocked = Boolean(
    device.busy && device.session_id && !String(device.session_id).startsWith('manual_'),
  );

  const copyText = async (text: string, successMsg: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      toast(successMsg, 'success');
    } catch {
      toast('Failed to copy', 'error');
    }
  };

  const serverUrl = formatAppiumServerUrl(device.host);
  const typeLabel = deviceTypeLabel(device.deviceType);

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
      <div className="dc2-stripe" />

      <div className="dc2-header">
        <span className="dc2-platform">
          {device.platform.toUpperCase()} · {device.sdk}
        </span>
        <StatusCode kind={kind} showDot>
          {kind}
        </StatusCode>
      </div>

      <div className="dc2-name" title={device.name}>
        {device.name}
      </div>
      <div className="dc2-udid-row">
        <div className="dc2-udid" title={device.udid}>
          {middleEllipsis(device.udid)}
        </div>
        <button
          type="button"
          className="dc2-udid-copy"
          onClick={() => copyText(device.udid, 'UDID copied')}
          aria-label="Copy UDID"
          title="Copy UDID"
        >
          <Copy size={12} />
        </button>
      </div>

      <HealthBadges device={device} />

      <div className="dc2-tags">
        {typeLabel && (
          <Pill tone="neutral" title={`Device type: ${typeLabel}`}>
            {typeLabel}
          </Pill>
        )}
        <DeviceTeamChip
          udid={device.udid}
          currentTeamId={device.teamId ?? null}
          resolvedTeamName={device.teamName ?? null}
          teams={teams ?? new Map()}
          canEdit={canEditTeam}
          onChanged={reloadDevices}
        />
        {device.tags?.slice(0, 3).map((t) => (
          <Pill key={t} tone="neutral" title={t}>
            {t}
          </Pill>
        ))}
        {(device.tags?.length || 0) > 3 && (
          <Pill tone="neutral">+{(device.tags?.length || 0) - 3}</Pill>
        )}
      </div>

      <div className="dc2-metrics">
        {reserved ? (
          <div className="dc2-banner dc2-banner-reserved">
            <Clock size={12} />
            <span>
              RES · {device.reservedBy || 'anon'}
              {device.reservedUntil
                ? ` (${prettyMilliseconds(device.reservedUntil - Date.now(), { compact: true })})`
                : ''}
            </span>
          </div>
        ) : device.session_id ? (
          <div className="dc2-banner dc2-banner-session">
            <Terminal size={12} />
            <span>SID · {String(device.session_id).slice(0, 10)}</span>
          </div>
        ) : (
          <KeyValueRow
            label="Time in use"
            value={
              device.totalUtilizationTimeMilliSec
                ? prettyMilliseconds(device.totalUtilizationTimeMilliSec, { compact: true })
                : '—'
            }
          />
        )}
        <KeyValueRow label="Network" value={formatDeviceNetworkAddress(device)} mono />
        <KeyValueRow
          label="Server"
          mono
          value={
            <span className="dc2-copyable">
              <span className="dc2-copyable-text" title={serverUrl}>
                {serverUrl}
              </span>
              {serverUrl !== '—' && (
                <button
                  type="button"
                  className="dc2-udid-copy"
                  onClick={() => copyText(serverUrl, 'Server URL copied')}
                  aria-label="Copy Appium server URL"
                  title="Copy Appium server URL"
                >
                  <Copy size={12} />
                </button>
              )}
            </span>
          }
        />
      </div>

      <div className="dc2-actions">
        <Button
          variant="primary"
          size="sm"
          disabled={busyLocked}
          onClick={() => {
            if (busyLocked) return;
            navigate(`/devices/${device.udid}/control`);
          }}
          title={busyLocked ? 'Locked: Appium session running' : 'Take control'}
          className="dc2-primary"
        >
          Control
        </Button>
        {reserved ? (
          <Button variant="secondary" size="sm" onClick={release}>
            Release
          </Button>
        ) : !device.userBlocked && !device.busy ? (
          <Button variant="secondary" size="sm" onClick={() => setShowReservation(true)}>
            Reserve
          </Button>
        ) : null}
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
          <Menu>
            <MenuItem
              icon={<Copy size={12} />}
              onClick={() => {
                setMenuOpen(false);
                copyText(formatSessionCapabilitiesJson(device), 'Session capabilities copied');
              }}
            >
              Copy caps…
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenuOpen(false);
                setShowTagManager(true);
              }}
            >
              Manage tags…
            </MenuItem>
            {device.userBlocked ? (
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  unblock();
                }}
              >
                Exit maintenance
              </MenuItem>
            ) : (
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  block();
                }}
              >
                Enter maintenance
              </MenuItem>
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
