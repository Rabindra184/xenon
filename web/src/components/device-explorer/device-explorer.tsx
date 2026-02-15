import React from 'react';
import { Smartphone as AndroidIcon, Apple as AppleIcon, Search, RefreshCw } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import CardView from './card-view/card-view';
import './device-explorer.css';
import XenonApiService from '../../api-service';
import DeviceControl from '../device-control/device-control';
import { IDeviceFilter } from '../../interfaces/IDeviceFilter';
import { IDevice } from '../../interfaces/IDevice';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { useSocket } from '../../hooks/useSocket';

interface IDeviceExplorerState {
  filter: IDeviceFilter;
  devices: IDevice[];
  activeSessionsCount: number;
  pendingSessionsCount: number;
  queueSummary: any;
}

const DEFAULT_FILTER: IDeviceFilter = {
  platform: {
    ios: true,
    android: true,
  },
  state: {
    ready: true,
    offline: true,
    busy: true,
  },
  name: '',
};

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
      filter: DEFAULT_FILTER,
    };
  }

  componentDidMount() {
    this.fetchDevices();
    this.devicePolling = setInterval(() => {
      this.fetchDevices();
    }, 10000);

    // Register real-time updates
    const unblockedCleanup = this.props.onSocketEvent('device_unblocked', () => {
      console.info('Real-time: Device unblocked, triggering debounced refresh');
      this.fetchDevicesDebounced();
    });
    const blockedCleanup = this.props.onSocketEvent('device_blocked', () => {
      console.info('Real-time: Device blocked, triggering debounced refresh');
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
    }, 500); // 500ms debounce
  }

  getBusyDevicesCount(devices: Array<IDevice>) {
    const filters = [(d: IDevice) => d.busy];
    return filters.reduce((devices: Array<IDevice>, predicate: (d: IDevice) => boolean) => {
      return devices.filter(predicate);
    }, devices).length;
  }

  async fetchDevices() {
    try {
      const devices = await XenonApiService.getDevices();
      const activeSessionsCount = this.getBusyDevicesCount(devices);
      const pendingSessionsCount = await XenonApiService.getPendingSessionsCount();
      const queueSummary = await XenonApiService.getQueueSummary();
      console.log(devices);

      this.setState({ devices, activeSessionsCount, pendingSessionsCount, queueSummary });
    } catch (error) {
      console.log(error);
    }
  }

  getFilteredDevice() {
    const { ready, busy, offline } = this.state.filter.state;
    const { ios, android } = this.state.filter.platform;
    const filters = [
      (d: IDevice) =>
        (ios && (d.platform == 'ios' || d.platform == 'tvos')) ||
        (android && d.platform == 'android'),
      (d: IDevice) =>
        (ready && !d.busy && !d.offline) || (busy && d.busy) || (offline && d.offline),
    ];

    if (this.state.filter.name != '') {
      filters.push(
        (d: IDevice) =>
          d.name.toLowerCase().includes(this.state.filter.name.toLowerCase()) ||
          d.udid.toLowerCase().includes(this.state.filter.name.toLowerCase()),
      );
    }
    return filters.reduce((acc: Array<IDevice>, predicate: (d: IDevice) => boolean) => {
      return acc.filter(predicate);
    }, this.state.devices);
  }

  setFilter(newFilter: Partial<IDeviceFilter>) {
    this.setState({
      filter: {
        ...this.state.filter,
        ...newFilter,
      },
    });
  }

  /* Render filter components */
  getPlatformFilterComponent() {
    const { ios, android } = this.state.filter.platform;
    return (
      <div className="device-explorer-header-value">
        <button
          className={`device-explorer-header__platform-btn ${android && 'selected'}`}
          onClick={() =>
            this.setFilter({
              platform: {
                ...this.state.filter.platform,
                android: !this.state.filter.platform.android,
              },
            })
          }
        >
          <AndroidIcon size={20} color="currentColor" />
          Android
        </button>
        <button
          className={`device-explorer-header__platform-btn ${ios && 'selected'}`}
          onClick={() =>
            this.setFilter({
              platform: {
                ...this.state.filter.platform,
                ios: !this.state.filter.platform.ios,
              },
            })
          }
        >
          <AppleIcon size={20} color="currentColor" />
          iOS
        </button>
      </div>
    );
  }

  getDeviceStateFilterComponent() {
    const { ready, busy, offline } = this.state.filter.state;
    return (
      <div className="device-explorer-header-value">
        <div
          className={`device-explorer-header__device-state ready ${ready && 'selected'}`}
          onClick={() =>
            this.setFilter({
              state: {
                ...this.state.filter.state,
                ready: !this.state.filter.state.ready,
              },
            })
          }
        >
          Ready
        </div>
        <div
          className={`device-explorer-header__device-state busy ${busy && 'selected'}`}
          onClick={() =>
            this.setFilter({
              state: {
                ...this.state.filter.state,
                busy: !this.state.filter.state.busy,
              },
            })
          }
        >
          Busy
        </div>
        <div
          className={`device-explorer-header__device-state offline ${offline && 'selected'}`}
          onClick={() =>
            this.setFilter({
              state: {
                ...this.state.filter.state,
                offline: !this.state.filter.state.offline,
              },
            })
          }
        >
          Offline
        </div>
      </div>
    );
  }

  render() {
    const devices = this.getFilteredDevice();
    const { udid } = this.props.params;
    const selectedDevice = udid ? this.state.devices.find((d) => d.udid === udid) : null;

    return (
      <div className="device-explorer-container">
        <div className="device-explorer-header-container">
          <div className="device-explorer-header-left-container">
            <div className="device-explorer-header-entry">
              <div className="device-explorer-header-entry-header">Platform</div>
              {this.getPlatformFilterComponent()}
            </div>
            <div className="device-explorer-header-entry">
              <div className="device-explorer-header-entry-header">Device state</div>
              {this.getDeviceStateFilterComponent()}
            </div>
            <div className="device-explorer-header-entry search-entry">
              <div className="device-explorer-header-entry-header">Search by name or udid</div>
              <div className="device-explorer-header-value">
                <div className="device-explorer-search-wrapper">
                  <Search size={16} color="#94a3b8" className="device-explorer-search-icon" />
                  <input
                    type="text"
                    className="device-explorer-header-text-filter"
                    placeholder="Search devices..."
                    onChange={(e) => {
                      this.setState({
                        filter: {
                          ...this.state.filter,
                          name: e.target.value,
                        },
                      });
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="device-explorer-header-filter-count">
            <Badge variant="secondary">
              <span className="font-bold">{devices.length}</span> of{' '}
              <span className="font-bold">{this.state.devices.length}</span>{' '}
              {this.state.devices.length === 1 ? 'device' : 'devices'}
            </Badge>
          </div>
          <div className="device-explorer-header-right-container">
            {this.state.queueSummary && this.state.pendingSessionsCount > 0 && (
              <Badge variant="secondary" className="mr-2">
                <span className="font-bold">Queue Insights:</span>{' '}
                {Object.entries(this.state.queueSummary.byPlatform).map(([p, data]: any) => (
                  <span key={p} className="ml-1">
                    {p === 'any' ? 'Mixed' : p.toUpperCase()}:{' '}
                    {Math.ceil(data.avgDurationMs / 60000)}m ETA
                  </span>
                ))}
              </Badge>
            )}
            <Badge variant="success">
              <span className="font-bold">{this.state.activeSessionsCount}</span> Active session
              {this.state.activeSessionsCount !== 1 ? 's' : ''}
            </Badge>
            <Badge variant="warning">
              <span className="font-bold">{this.state.pendingSessionsCount}</span> Pending session
              {this.state.pendingSessionsCount !== 1 ? 's' : ''}
            </Badge>
            <Button size="sm" variant="default" onClick={() => this.fetchDevices()}>
              <RefreshCw size={14} color="currentColor" className="mr-1" />
              Refresh
            </Button>
          </div>
        </div>
        <CardView devices={devices} reloadDevices={() => this.fetchDevices()} />
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
