import React from 'react';
import { Smartphone as AndroidIcon, RefreshCw } from 'lucide-react';
import { PageHeader } from '../ui/page-header';
import { useParams, useNavigate } from 'react-router-dom';
import CardView from './card-view/card-view';
import './device-explorer.css';
import XenonApiService from '../../api-service';
import DeviceControl from '../device-control/device-control';
import { IDevice } from '../../interfaces/IDevice';
import { Button } from '../ui/button';
import { SegmentedControl } from '../ui/SegmentedControl';
import { useSocket } from '../../hooks/useSocket';

type StatusFilter = 'all' | 'ready' | 'busy' | 'reserved' | 'offline';

interface IDeviceExplorerState {
  devices: IDevice[];
  activeSessionsCount: number;
  pendingSessionsCount: number;
  queueSummary: any;
  statusFilter: StatusFilter;
  search: string;
}

interface IDeviceExplorerProps {
  params: any;
  navigate: any;
  onSocketEvent: (event: string, callback: (data: any) => void) => () => void;
}

export class DeviceExplorer extends React.Component<IDeviceExplorerProps, IDeviceExplorerState> {
  private devicePolling: any;
  private socketCleanups: (() => void)[] = [];
  private refreshTimeout: NodeJS.Timeout | null = null;

  constructor(props: any) {
    super(props);
    this.state = {
      devices: [],
      activeSessionsCount: 0,
      pendingSessionsCount: 0,
      queueSummary: null,
      statusFilter: 'all',
      search: '',
    };
  }

  componentDidMount() {
    this.fetchDevices();
    this.devicePolling = setInterval(() => {
      this.fetchDevices();
    }, 10000);

    const unblockedCleanup = this.props.onSocketEvent('device_unblocked', () => {
      this.fetchDevicesDebounced();
    });
    const blockedCleanup = this.props.onSocketEvent('device_blocked', () => {
      this.fetchDevicesDebounced();
    });
    this.socketCleanups.push(unblockedCleanup, blockedCleanup);
  }

  componentWillUnmount() {
    if (this.devicePolling) {
      clearInterval(this.devicePolling);
      this.devicePolling = undefined;
    }
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
    this.socketCleanups.forEach((cleanup) => cleanup());
  }

  fetchDevicesDebounced() {
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    this.refreshTimeout = setTimeout(() => {
      this.refreshTimeout = null;
      this.fetchDevices();
    }, 500);
  }

  getBusyDevicesCount(devices: Array<IDevice>) {
    return devices.filter((d: IDevice) => d.busy).length;
  }

  async fetchDevices() {
    try {
      const devices = await XenonApiService.getDevices();
      const activeSessionsCount = this.getBusyDevicesCount(devices);
      const pendingSessionsCount = await XenonApiService.getPendingSessionsCount();
      const queueSummary = await XenonApiService.getQueueSummary();
      this.setState({ devices, activeSessionsCount, pendingSessionsCount, queueSummary });
    } catch (error) {
      console.log(error);
    }
  }

  getFiltered(): IDevice[] {
    const now = Date.now();
    const isReserved = (d: IDevice) => Boolean(d.reservedUntil && now < d.reservedUntil);
    const q = this.state.search.trim().toLowerCase();

    return this.state.devices.filter((d) => {
      if (q) {
        const hay = `${d.name} ${d.udid}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      switch (this.state.statusFilter) {
        case 'all':
          return true;
        case 'offline':
          return d.offline;
        case 'busy':
          return d.busy && !d.offline;
        case 'reserved':
          return isReserved(d) && !d.busy && !d.offline;
        case 'ready':
          return !d.offline && !d.busy && !isReserved(d) && !d.userBlocked;
        default:
          return true;
      }
    });
  }

  statusCount(kind: StatusFilter): number {
    const now = Date.now();
    const isReserved = (d: IDevice) => Boolean(d.reservedUntil && now < d.reservedUntil);
    switch (kind) {
      case 'all':
        return this.state.devices.length;
      case 'offline':
        return this.state.devices.filter((d) => d.offline).length;
      case 'busy':
        return this.state.devices.filter((d) => d.busy && !d.offline).length;
      case 'reserved':
        return this.state.devices.filter((d) => isReserved(d) && !d.busy && !d.offline).length;
      case 'ready':
        return this.state.devices.filter(
          (d) => !d.offline && !d.busy && !isReserved(d) && !d.userBlocked,
        ).length;
    }
  }

  render() {
    const devices = this.getFiltered();
    const { udid } = this.props.params;
    const selectedDevice = udid ? this.state.devices.find((d) => d.udid === udid) : null;

    return (
      <div className="device-explorer-container">
        <div className="de2-sticky-group">
          <PageHeader
            icon={AndroidIcon}
            title="Devices"
            subtitle={`${this.state.devices.length} device${this.state.devices.length === 1 ? '' : 's'} registered across the global pool.`}
          />
          <div className="de2-toolbar">
          <SegmentedControl
            size="sm"
            value={this.state.statusFilter}
            onChange={(v) => this.setState({ statusFilter: v })}
            segments={[
              { value: 'all', label: 'All', count: this.statusCount('all') },
              { value: 'ready', label: 'Ready', count: this.statusCount('ready') },
              { value: 'busy', label: 'Busy', count: this.statusCount('busy') },
              { value: 'reserved', label: 'Reserved', count: this.statusCount('reserved') },
              { value: 'offline', label: 'Offline', count: this.statusCount('offline') },
            ]}
          />
          <input
            type="text"
            className="de2-search"
            placeholder="Search by name or UDID…"
            value={this.state.search}
            onChange={(e) => this.setState({ search: e.target.value })}
          />
          <Button variant="secondary" size="sm" onClick={() => this.fetchDevices()}>
            <RefreshCw size={12} /> Refresh
          </Button>
          </div>
        </div>

        {devices.length > 0 ? (
          <CardView devices={devices} reloadDevices={() => this.fetchDevices()} />
        ) : (
          <div className="device-explorer-empty stagger-1">
            <div className="device-explorer-empty-icon">
              <AndroidIcon size={32} />
            </div>
            {this.state.devices.length === 0 ? (
              <>
                <h3>Global Device Registry Empty</h3>
                <p>
                  Xenon hasn't detected any active device nodes in your infrastructure. Ensure your
                  device farm is connected and heartbeat signals are active.
                </p>
                <Button variant="primary" onClick={() => this.fetchDevices()}>
                  <RefreshCw size={14} />
                  Manual Sync
                </Button>
              </>
            ) : (
              <>
                <h3>No Devices Found</h3>
                <p>
                  Deployment configuration mismatch. Adjust your platform or state filters to find
                  the appropriate testing target.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => this.setState({ statusFilter: 'all', search: '' })}
                >
                  Reset filters
                </Button>
              </>
            )}
          </div>
        )}
        {selectedDevice && (
          <div className="device-control-modal-overlay">
            <div className="device-control-modal">
              <DeviceControl
                device={selectedDevice}
                onClose={() => this.props.navigate('/devices')}
              />
            </div>
          </div>
        )}
      </div>
    );
  }
}

export default function DeviceExplorerWrapper() {
  const params = useParams();
  const navigate = useNavigate();
  const { on } = useSocket();
  return <DeviceExplorer params={params} navigate={navigate} onSocketEvent={on} />;
}
