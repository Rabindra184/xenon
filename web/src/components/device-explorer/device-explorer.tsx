import React from 'react';
import { Smartphone as AndroidIcon, RefreshCw } from 'lucide-react';
import { PageHeader } from '../ui/page-header';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import CardView from './card-view/card-view';
import './device-explorer.css';
import XenonApiService from '../../api-service';
import DeviceControl from '../device-control/device-control';
import { IDevice } from '../../interfaces/IDevice';
import { Button } from '../ui/button';
import { InPlaceDialog } from '../ui/InPlaceDialog';
import { SegmentedControl, type Segment } from '../ui/SegmentedControl';
import { useSocket } from '../../hooks/useSocket';
import {
  deviceMatches,
  facetCounts,
  filtersToParams,
  hasTvos,
  NO_FILTERS,
  parseFilters,
  type DeviceFilters,
  type PlatformFilter,
  type StatusFilter,
  type TypeFilter,
} from './deviceFilters';

interface IDeviceExplorerState {
  devices: IDevice[];
  activeSessionsCount: number;
  pendingSessionsCount: number;
  queueSummary: any;
  loaded: boolean;
}

interface IDeviceExplorerProps {
  params: any;
  navigate: any;
  onSocketEvent: (event: string, callback: (data: any) => void) => () => void;
  /** Read from the link, so a reload or a shared link shows the same view. */
  filters: DeviceFilters;
  onFiltersChange: (filters: DeviceFilters) => void;
  /** The current query string, kept when a device is closed. */
  locationSearch: string;
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

  setFilters(patch: Partial<DeviceFilters>) {
    this.props.onFiltersChange({ ...this.props.filters, ...patch });
  }

  getFiltered(): IDevice[] {
    const now = Date.now();
    return this.state.devices.filter((d) => deviceMatches(d, this.props.filters, now));
  }

  render() {
    const devices = this.getFiltered();
    const { udid } = this.props.params;
    const selectedDevice = udid ? this.state.devices.find((d) => d.udid === udid) : null;
    const { filters } = this.props;
    const counts = facetCounts(this.state.devices, filters, Date.now());
    const platformSegments: Segment<PlatformFilter>[] = [
      { value: 'all', label: 'All', count: counts.platform.all },
      { value: 'android', label: 'Android', count: counts.platform.android },
      { value: 'ios', label: 'iOS', count: counts.platform.ios },
    ];
    if (hasTvos(this.state.devices) || filters.platform === 'tvos') {
      platformSegments.push({ value: 'tvos', label: 'tvOS', count: counts.platform.tvos });
    }
    const closeTo = `/devices${this.props.locationSearch}`;

    return (
      <div className="device-explorer-container">
        <div className="de2-sticky-group">
          <PageHeader
            icon={AndroidIcon}
            title="Devices"
            subtitle={`${this.state.devices.length} device${this.state.devices.length === 1 ? '' : 's'} registered across the global pool.`}
          />
          <div className="de2-toolbar">
            <SegmentedControl<StatusFilter>
              size="sm"
              label="Status"
              value={filters.status}
              onChange={(v) => this.setFilters({ status: v })}
              segments={[
                { value: 'all', label: 'All', count: counts.status.all },
                // Each dot is the colour of that state's cards.
                { value: 'ready', label: 'Ready', tone: 'ready', count: counts.status.ready },
                { value: 'busy', label: 'Busy', tone: 'busy', count: counts.status.busy },
                {
                  value: 'reserved',
                  label: 'Reserved',
                  tone: 'reserved',
                  count: counts.status.reserved,
                },
                {
                  value: 'maintenance',
                  label: 'Maintenance',
                  tone: 'maintenance',
                  count: counts.status.maintenance,
                },
                {
                  value: 'offline',
                  label: 'Offline',
                  tone: 'offline',
                  count: counts.status.offline,
                },
              ]}
            />
            {/* Platform and type sit with the search on a row of their own. */}
            <div className="de2-toolbar-row">
              <SegmentedControl<PlatformFilter>
                size="sm"
                label="Platform"
                value={filters.platform}
                onChange={(v) => this.setFilters({ platform: v })}
                segments={platformSegments}
              />
              <SegmentedControl<TypeFilter>
                size="sm"
                label="Device type"
                value={filters.type}
                onChange={(v) => this.setFilters({ type: v })}
                segments={[
                  { value: 'all', label: 'All', count: counts.type.all },
                  { value: 'real', label: 'Real', count: counts.type.real },
                  {
                    value: 'virtual',
                    label: 'Virtual',
                    title: 'Simulators and emulators',
                    count: counts.type.virtual,
                  },
                ]}
              />
              {/* Search and Refresh wrap together: alone on a line, Refresh looked
                  stranded. */}
              <div className="de2-find">
                <input
                  type="text"
                  className="de2-search"
                  aria-label="Search devices"
                  placeholder="Search name, model or UDID…"
                  value={filters.q}
                  onChange={(e) => this.setFilters({ q: e.target.value })}
                />
                <Button variant="secondary" size="sm" onClick={() => this.fetchDevices()}>
                  <RefreshCw size={12} /> Refresh
                </Button>
              </div>
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
                <h3>No devices match these filters</h3>
                <p>Try another filter or search, or clear them to see every device.</p>
                <Button variant="secondary" onClick={() => this.props.onFiltersChange(NO_FILTERS)}>
                  Clear filters
                </Button>
              </>
            )}
          </div>
        )}
        {selectedDevice && (
          <InPlaceDialog
            className="device-control-modal-overlay"
            labelledBy="device-control-title"
            onClose={() => this.props.navigate(closeTo)}
          >
            <div className="device-control-modal">
              <DeviceControl
                device={selectedDevice}
                titleId="device-control-title"
                onClose={() => this.props.navigate(closeTo)}
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
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { on } = useSocket();
  return (
    <DeviceExplorer
      params={params}
      navigate={navigate}
      onSocketEvent={on}
      filters={parseFilters(searchParams)}
      // Replace, so Back leaves the page instead of replaying every keystroke.
      onFiltersChange={(next) => setSearchParams(filtersToParams(next), { replace: true })}
      locationSearch={location.search}
    />
  );
}
