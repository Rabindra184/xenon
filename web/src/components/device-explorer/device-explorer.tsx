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
import { InPlaceDialog } from '../ui/InPlaceDialog';
import { SegmentedControl } from '../ui/SegmentedControl';
import { useSocket } from '../../hooks/useSocket';
import { deviceState, type DeviceState } from '../device-card/device-card/deviceState';

// One state per device, shared with the cards, so the filters add up to All.
type StatusFilter = 'all' | DeviceState;

interface IDeviceExplorerState {
  devices: IDevice[];
  activeSessionsCount: number;
  pendingSessionsCount: number;
  queueSummary: any;
  statusFilter: StatusFilter;
  search: string;
  loaded: boolean;
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
      loaded: false,
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
      this.setState({ devices, activeSessionsCount, pendingSessionsCount, queueSummary, loaded: true });
    } catch (error) {
      console.log(error);
      // Mark loaded even on failure so the UI leaves the loading state and shows
      // the (empty/registry) view rather than spinning forever.
      this.setState({ loaded: true });
    }
  }

  getFiltered(): IDevice[] {
    const now = Date.now();
    const q = this.state.search.trim().toLowerCase();
    const filter = this.state.statusFilter;

    return this.state.devices.filter((d) => {
      if (q) {
        const hay = `${d.name} ${d.udid}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return filter === 'all' || deviceState(d, now) === filter;
    });
  }

  statusCount(kind: StatusFilter): number {
    if (kind === 'all') return this.state.devices.length;
    const now = Date.now();
    return this.state.devices.filter((d) => deviceState(d, now) === kind).length;
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
                // Each dot is the colour of that state's cards.
                {
                  value: 'ready',
                  label: 'Ready',
                  tone: 'ready',
                  count: this.statusCount('ready'),
                },
                { value: 'busy', label: 'Busy', tone: 'busy', count: this.statusCount('busy') },
                {
                  value: 'reserved',
                  label: 'Reserved',
                  tone: 'reserved',
                  count: this.statusCount('reserved'),
                },
                {
                  value: 'maintenance',
                  label: 'Maintenance',
                  tone: 'maintenance',
                  count: this.statusCount('maintenance'),
                },
                {
                  value: 'offline',
                  label: 'Offline',
                  tone: 'offline',
                  count: this.statusCount('offline'),
                },
              ]}
            />
            {/* Search and Refresh wrap together: alone on a line, Refresh looked
                stranded. */}
            <div className="de2-find">
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
        </div>

        {devices.length > 0 ? (
          <CardView devices={devices} reloadDevices={() => this.fetchDevices()} />
        ) : (
          <div className="device-explorer-empty stagger-1">
            <div className="device-explorer-empty-icon">
              {!this.state.loaded ? (
                <RefreshCw size={32} className="animate-spin" />
              ) : (
                <AndroidIcon size={32} />
              )}
            </div>
            {!this.state.loaded ? (
              <>
                <h3>Loading devices…</h3>
                <p>Syncing the global device registry.</p>
              </>
            ) : this.state.devices.length === 0 ? (
              <>
                <h3>Global Device Registry Empty</h3>
                <p>
                  Xenon hasn't detected any active device nodes in your infrastructure. Ensure your
                  device farm is connected and heartbeat signals are active.
                </p>
                <Button variant="primary" onClick={() => this.fetchDevices()}>
                  <RefreshCw size={14} />
                  Manual sync
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
          <InPlaceDialog
            className="device-control-modal-overlay"
            labelledBy="device-control-title"
            onClose={() => this.props.navigate('/devices')}
          >
            <div className="device-control-modal">
              <DeviceControl
                device={selectedDevice}
                titleId="device-control-title"
                onClose={() => this.props.navigate('/devices')}
              />
            </div>
          </InPlaceDialog>
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
