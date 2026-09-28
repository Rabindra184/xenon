import * as React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { IDevice } from '../../../interfaces/IDevice';
import XenonApiService from '../../../api-service';
import { platformLabel } from '../../../lib/labels';
import {
  DeviceControlButtons,
  DeviceMoreMenu,
  TeamPicker,
  useDeviceActions,
} from '../../device-card/device-card/DeviceActions';
import {
  deviceSubtitle,
  deviceTeamName,
  deviceTitle,
} from '../../device-card/device-card/deviceIdentity';
import { STATE_LABEL } from '../../device-card/device-card/deviceState';
import { StatusDot } from '../../ui/StatusDot';
import { Table, TBody, TD, TH, THead, TR } from '../../ui/Table';
import { isVirtual } from '../deviceFilters';
import { sortDevices, type DeviceSort, type SortKey } from '../deviceSort';
import './device-table.css';

interface Props {
  devices: IDevice[];
  reloadDevices: () => void;
  sort: DeviceSort;
  onSortChange: (s: DeviceSort) => void;
  navigate: (path: string) => void;
  teams: Map<string, string>;
}

/** A sortable `<TH>`: clicking it sorts by it (ascending), or flips the
 *  direction when it's already the active column. */
const SortableHeader: React.FC<{
  sortKey: SortKey;
  label: string;
  sort: DeviceSort;
  onSortChange: (s: DeviceSort) => void;
}> = ({ sortKey, label, sort, onSortChange }) => {
  const active = sort.key === sortKey;
  const dir = active ? sort.dir : 'asc';
  return (
    <TH scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className="devtable-sort"
        onClick={() =>
          onSortChange(
            active
              ? { key: sortKey, dir: dir === 'asc' ? 'desc' : 'asc' }
              : { key: sortKey, dir: 'asc' },
          )
        }
      >
        {label}
        {active &&
          (dir === 'asc' ? (
            <ArrowUp size={12} aria-hidden="true" />
          ) : (
            <ArrowDown size={12} aria-hidden="true" />
          ))}
      </button>
    </TH>
  );
};

/** One row: identical actions/state as the card, via the same `useDeviceActions`. */
const DeviceRow: React.FC<{
  device: IDevice;
  reloadDevices: () => void;
  navigate: (path: string) => void;
  teams: Map<string, string>;
  showHost: boolean;
}> = ({ device, reloadDevices, navigate, teams, showHost }) => {
  const actions = useDeviceActions(device, reloadDevices);
  const { kind, activity, control } = actions;
  const title = deviceTitle(device);
  const subtitle = deviceSubtitle(device);
  const teamName = deviceTeamName(device, teams);
  const platformText = `${platformLabel(device.platform)} ${device.sdk ?? ''}`;
  const tags = device.tags ?? [];
  const reasonId = `devtable-reason-${device.udid}`;

  return (
    <TR className={`devtable-row${kind === 'offline' ? ' is-offline' : ''}`}>
      <TD>
        <div className="devtable-line">
          <StatusDot kind={kind} className="devtable-status-dot" /> {STATE_LABEL[kind]}
        </div>
        {activity && (
          <div className="devtable-muted devtable-line" title={activity}>
            {activity}
          </div>
        )}
      </TD>
      <TH scope="row" className="devtable-rowheader" title={`${title}\n${device.udid}`}>
        <div className="devtable-title devtable-line">{title}</div>
        <div className="devtable-muted devtable-line" title={subtitle}>
          {subtitle}
        </div>
      </TH>
      <TD title={platformText}>{platformText}</TD>
      <TD>{isVirtual(device) ? 'Virtual' : 'Real'}</TD>
      <TD title={actions.editingTeam ? undefined : (teamName ?? 'Shared')}>
        {actions.editingTeam ? (
          <TeamPicker
            udid={device.udid}
            currentTeamId={device.teamId ?? null}
            teams={teams}
            onDone={(changed) => {
              actions.setEditingTeam(false);
              if (changed) reloadDevices();
            }}
          />
        ) : (
          (teamName ?? 'Shared')
        )}
      </TD>
      <TD title={tags.join(', ')}>
        {tags.slice(0, 2).map((t) => (
          <span key={t} className="devtable-tag">
            #{t}
          </span>
        ))}
        {tags.length > 2 && <span className="devtable-tag">+{tags.length - 2}</span>}
      </TD>
      {showHost && <TD title={device.host}>{device.host}</TD>}
      <TD className="devtable-actions" title={control.enabled ? undefined : control.reason}>
        <div className="devtable-actions-inner">
          <DeviceControlButtons
            device={device}
            actions={actions}
            navigate={navigate}
            reasonId={reasonId}
          />
          {!control.enabled && (
            <span id={reasonId} className="sr-only">
              {control.reason}
            </span>
          )}
          <DeviceMoreMenu device={device} actions={actions} />
        </div>
      </TD>
      {actions.dialogs}
    </TR>
  );
};

export function DeviceTable({
  devices,
  reloadDevices,
  sort,
  onSortChange,
  navigate,
  teams,
}: Props) {
  // Host shows only when there is more than one, or while it is the sort: a
  // filter can leave one host, and hiding the sorted column then left no
  // header saying how the rows are ordered.
  const showHost = new Set(devices.map((d) => d.host)).size > 1 || sort.key === 'host';
  const sorted = sortDevices(devices, sort, { now: Date.now(), teams });

  return (
    <Table className="devtable">
      <caption className="sr-only">Devices, {devices.length} shown</caption>
      <colgroup>
        <col className="devtable-col-status" />
        <col />
        <col className="devtable-col-platform" />
        <col className="devtable-col-type" />
        <col className="devtable-col-team" />
        <col className="devtable-col-tags" />
        {showHost && <col className="devtable-col-host" />}
        <col className="devtable-col-actions" />
      </colgroup>
      <THead>
        <TR>
          <SortableHeader sortKey="status" label="Status" sort={sort} onSortChange={onSortChange} />
          <SortableHeader sortKey="device" label="Device" sort={sort} onSortChange={onSortChange} />
          <SortableHeader
            sortKey="platform"
            label="Platform"
            sort={sort}
            onSortChange={onSortChange}
          />
          <SortableHeader sortKey="type" label="Type" sort={sort} onSortChange={onSortChange} />
          <SortableHeader sortKey="team" label="Team" sort={sort} onSortChange={onSortChange} />
          <TH scope="col">Tags</TH>
          {showHost && (
            <SortableHeader sortKey="host" label="Host" sort={sort} onSortChange={onSortChange} />
          )}
          <TH scope="col">Actions</TH>
        </TR>
      </THead>
      <TBody>
        {sorted.map((device) => (
          <DeviceRow
            key={device.udid}
            device={device}
            reloadDevices={reloadDevices}
            navigate={navigate}
            teams={teams}
            showHost={showHost}
          />
        ))}
      </TBody>
    </Table>
  );
}

export default function DeviceTableWrapper(props: {
  devices: IDevice[];
  reloadDevices: () => void;
  sort: DeviceSort;
  onSortChange: (s: DeviceSort) => void;
}) {
  const navigate = useNavigate();
  // Opening a device keeps the Devices filters, so closing it returns to them.
  const { search } = useLocation();
  const [teams, setTeams] = React.useState<Map<string, string>>(new Map());

  React.useEffect(() => {
    XenonApiService.listTeams()
      .then((rows) => setTeams(new Map(rows.map((t) => [t.id, t.name]))))
      .catch(() => {
        // Silent failure -> chip falls back to id-slice display, as CardView does.
      });
  }, []);

  return (
    <DeviceTable
      devices={props.devices}
      reloadDevices={props.reloadDevices}
      sort={props.sort}
      onSortChange={props.onSortChange}
      navigate={(path) => navigate(`${path}${search}`)}
      teams={teams}
    />
  );
}
