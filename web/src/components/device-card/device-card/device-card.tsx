import * as React from 'react';
import { Smartphone, Tablet, Tv } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IDevice } from '../../../interfaces/IDevice';
import { Pill } from '../../ui/Pill';
import { HealthBadges } from '../health-badges';
import './device-card.css';
import { STATE_LABEL } from './deviceState';
import { deviceFormFactor, deviceSubtitle, deviceTeamName, deviceTitle } from './deviceIdentity';
import {
  DeviceControlButtons,
  DeviceMoreMenu,
  TeamPicker,
  useDeviceActions,
} from './DeviceActions';

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

/** Phone, tablet or TV outline; dashed for emulators and simulators. */
const FormFactorIcon: React.FC<{ device: IDevice }> = ({ device }) => {
  const Icon = { phone: Smartphone, tablet: Tablet, tv: Tv }[deviceFormFactor(device)];
  const virtual = device.deviceType === 'emulator' || device.deviceType === 'simulator';
  return <Icon size={26} strokeWidth={1.5} strokeDasharray={virtual ? '3 2' : undefined} />;
};

export const DeviceCard: React.FC<Props> = ({ device, reloadDevices, navigate, teams }) => {
  const actions = useDeviceActions(device, reloadDevices);
  const { kind, activity, control } = actions;
  const reasonId = `dc2-reason-${device.udid}`;
  const title = deviceTitle(device);
  const teamName = deviceTeamName(device, teams);

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
          {actions.editingTeam ? (
            <TeamPicker
              className="dc2-team-picker"
              udid={device.udid}
              currentTeamId={device.teamId ?? null}
              teams={teams ?? new Map()}
              onDone={(changed) => {
                actions.setEditingTeam(false);
                if (changed) reloadDevices();
              }}
            />
          ) : (
            teamName && (
              <Pill tone="accent" className="dc2-team" title={`Team: ${teamName}`}>
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
        <DeviceControlButtons
          device={device}
          actions={actions}
          navigate={navigate}
          reasonId={reasonId}
        />
        {/* Said on the card, not only in a tooltip: a disabled button gave no
            reason unless you hovered it. */}
        {!control.enabled && (
          <span id={reasonId} className="dc2-unavailable" title={control.reason}>
            {control.reason}
          </span>
        )}
        <span className="dc2-spacer" />
        <DeviceMoreMenu device={device} actions={actions} />
      </div>

      {actions.dialogs}
    </div>
  );
};

export default function DeviceCardWrapper(props: {
  device: IDevice;
  reloadDevices: () => void;
  teams?: Map<string, string>;
}) {
  const navigate = useNavigate();
  // Opening a device keeps the Devices filters, so closing it returns to them.
  const { search } = useLocation();
  return (
    <DeviceCard
      device={props.device}
      reloadDevices={props.reloadDevices}
      navigate={(path) => navigate(`${path}${search}`)}
      teams={props.teams}
    />
  );
}
