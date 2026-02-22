import React from 'react';
import './device-card.css';
import {
  Smartphone as AndroidIcon,
  Apple as AppleIcon,
  Link as LinkIcon,
  XCircle,
  Monitor,
  Unlock,
  Clock,
  Plus,
  ShieldCheck,
  Thermometer,
  HardDrive,
  Terminal,
  Wifi,
  Wrench,
  CalendarPlus,
} from 'lucide-react';
import { IDevice } from '../../../interfaces/IDevice';
import prettyMilliseconds from 'pretty-ms';
import XenonApiService from '../../../api-service';
import { useNavigate } from 'react-router-dom';
import ReservationModal from '../../reservation-modal/reservation-modal';
import TagManagerModal from '../../tag-manager-modal/tag-manager-modal';

interface IDeviceCardProps {
  device: IDevice;
  reloadDevices: () => void;
  navigate: any;
}

interface IDeviceCardState {
  showControl: boolean;
  showReservation: boolean;
  showTagManager: boolean;
}

export class DeviceCard extends React.Component<IDeviceCardProps, IDeviceCardState> {
  constructor(props: IDeviceCardProps) {
    super(props);
    this.state = {
      showReservation: false,
      showTagManager: false,
      showControl: false, // Keep for interface compatibility if needed, though unused
    };
  }
  getStatusClassName() {
    if (this.props.device.offline) {
      return 'disabled';
    } else if (this.props.device.busy) {
      return 'busy';
    } else if (this.isReserved()) {
      return 'reserved';
    } else {
      return '';
    }
  }

  getDeviceState() {
    if (this.props.device.offline) {
      return 'offline';
    } else if (this.props.device.userBlocked) {
      return 'maintenance';
    } else if (this.props.device.busy) {
      return 'busy';
    } else if (this.isReserved()) {
      return 'reserved';
    } else {
      return 'ready';
    }
  }

  isReserved() {
    const { reservedUntil } = this.props.device;
    if (!reservedUntil) return false;
    return Date.now() < reservedUntil;
  }

  getRemainingReservationTime() {
    const { reservedUntil } = this.props.device;
    if (!reservedUntil) return '';
    const diff = reservedUntil - Date.now();
    if (diff <= 0) return '';
    return prettyMilliseconds(diff, { compact: true });
  }

  async releaseReservation(udid: string, host: string) {
    await XenonApiService.releaseReservation(udid, host);
    this.props.reloadDevices();
  }

  async blockDevice(udid: string, host: string) {
    await XenonApiService.blockDevice(udid, host);
    this.props.reloadDevices();
  }

  async unblockDevice(udid: string, host: string) {
    await XenonApiService.unblockDevice(udid, host);
    this.props.reloadDevices();
  }

  async manageTags() {
    this.setState({ showTagManager: true });
  }

  render() {
    const {
      name,
      sdk,
      deviceType,
      platform,
      udid,
      dashboard_link,
      total_session_count,
      host,
      totalUtilizationTimeMilliSec,
      userBlocked,
      busy,
      session_id,
      reservedBy,
      reservedUntil,
      reservationReason,
      batteryLevel,
      thermalStatus,
      storageFree,
      tags,
      sessionProgress,
      totalHealedCount,
    } = this.props.device;

    const deviceState = this.getDeviceState();
    let hostName = '';
    try {
      hostName = new URL(host).hostname;
    } catch (error) {
      hostName = host.split(':')[1].replace('//', '');
    }

    const blockButton = () => {
      if (busy) return null;

      const isReserved = this.isReserved();

      if (isReserved) {
        return (
          <button
            className="tactical-btn reserved"
            onClick={() => this.releaseReservation(udid, host)}
            title={`Reserved by ${reservedBy}${reservationReason ? `: ${reservationReason}` : ''
              }. Expires: ${reservedUntil ? new Date(reservedUntil).toLocaleString() : 'Never'}`}
          >
            <Unlock size={14} color="#38bdf8" />
          </button>
        );
      }

      if (!userBlocked) {
        return (
          <>
            <button
              className="tactical-btn reserve"
              onClick={() => this.setState({ showReservation: true })}
              title="Reserve Device"
            >
              <CalendarPlus size={14} color="#38bdf8" />
            </button>
            <button
              className="tactical-btn maintenance"
              onClick={() => this.blockDevice(udid, host)}
              title="Enter Maintenance"
            >
              <Wrench size={14} color="#fbbf24" />
            </button>
          </>
        );
      } else {
        return (
          <button
            className="tactical-btn exit-maintenance"
            onClick={() => this.unblockDevice(udid, host)}
            title="Exit Maintenance"
          >
            <ShieldCheck size={14} />
          </button>
        );
      }
    };

    return (
      <div className={`device-info-card-container ${this.getStatusClassName()} group`}>
        {/* Mission Control Scanline Overlay */}
        <div className="scanline" style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: 0.1,
          zIndex: 0
        }}></div>

        {/* Compact Header */}
        <div className="card-header relative z-10">
          <div className="header-left">
            <div className={`platform-icon-wrapper ${platform}`}>
              {['ios', 'tvos'].includes(platform) ? (
                <AppleIcon size={14} />
              ) : (
                <AndroidIcon size={14} />
              )}
            </div>
            <div className="device-id-mono" title={udid}>
              {udid}
            </div>
          </div>
          <div className={`device-status-badge ${deviceState} ${deviceState === 'busy' && sessionProgress && sessionProgress !== 'Session Active' ? 'pulse' : ''}`}>
            {deviceState === 'busy' && sessionProgress && sessionProgress !== 'Session Active' ? sessionProgress : deviceState}
          </div>
        </div>

        {/* Device Name and Info */}
        <div className="device-info-main relative z-10">
          <h3 className="device-name" title={name}>{name}</h3>
          <p className="device-subtext">{deviceType.toUpperCase()} • {sdk}</p>

          {/* Inline Tags Display */}
          {this.props.device.tags && this.props.device.tags.length > 0 && (
            <div className="device-tags-inline">
              {this.props.device.tags.slice(0, 3).map(tag => (
                <span key={tag} className="inline-tag" title={tag}>{tag}</span>
              ))}
              {this.props.device.tags.length > 3 && (
                <span className="inline-tag-overflow">+{this.props.device.tags.length - 3}</span>
              )}
            </div>
          )}
        </div>

        {/* High-Density Metrics Grid */}
        <div className="metrics-grid relative z-10">
          <div className="metric-item" title={`Location: ${hostName}`}>
            <Monitor size={10} className="text-dim" />
            <span className="truncate">{hostName}</span>
          </div>

          {this.props.device.ip && (
            <div className="metric-item" title={`IP: ${this.props.device.ip}`}>
              <Wifi size={10} className="text-dim" />
              <span className="truncate">{this.props.device.ip}</span>
            </div>
          )}

          <div className={`metric-item health ${this.props.device.healthStatus?.toLowerCase() || 'healthy'}`} title={this.props.device.healthCheckError || 'Device is healthy'}>
            <div className="health-dot"></div>
            <span>{this.props.device.healthStatus || 'Healthy'}</span>
            {totalHealedCount && totalHealedCount > 0 && (
              <span className="heal-badge"><ShieldCheck size={8} /> {totalHealedCount}</span>
            )}
          </div>

          {thermalStatus && thermalStatus !== 'Unknown' && (
            <div className="metric-item thermal" title={`Thermal: ${thermalStatus}`}>
              <Thermometer size={10} style={{ color: thermalStatus === 'Nominal' ? 'var(--color-primary)' : 'var(--color-amber)' }} />
              <span>{thermalStatus}</span>
            </div>
          )}

          {batteryLevel !== undefined && (
            <div className="metric-item battery" title={`Battery: ${batteryLevel}%`}>
              <div className={`mini-battery ${batteryLevel < 20 ? 'low' : ''}`}>
                <div className="battery-fill" style={{ width: `${batteryLevel}%` }}></div>
              </div>
              <span>{batteryLevel}%</span>
            </div>
          )}

          {storageFree && storageFree !== 'Unknown' && (
            <div className="metric-item storage" title={`Free Space: ${storageFree}`}>
              <HardDrive size={10} style={{ color: 'var(--color-sky)' }} />
              <span>{storageFree}</span>
            </div>
          )}
        </div>

        {/* Utilization & Dynamic Info (Busy/Reserved) */}
        <div className="dynamic-data-layer relative z-10">
          {this.isReserved() ? (
            <div className="reservation-micro-banner">
              <Clock size={10} />
              <span>RES: {reservedBy || 'Anon'} ({this.getRemainingReservationTime()})</span>
            </div>
          ) : session_id ? (
            <div className="session-micro-banner">
              <Terminal size={10} />
              <span>SID: {session_id}</span>
            </div>
          ) : (
            <div className="utilization-micro-info">
              <span>UTIL: {prettyMilliseconds(totalUtilizationTimeMilliSec || 0, { compact: true })}</span>
            </div>
          )}
        </div>

        {/* Tactical Action Row */}
        <div className="action-row relative z-10">
          <button className="tactical-btn add-tag" onClick={() => this.manageTags()} title="Manage Tags">
            <Plus size={14} />
          </button>
          {blockButton()}

          <button
            className={`tactical-btn control-btn ${busy && !!session_id && !session_id.toString().startsWith('manual_') ? 'disabled' : ''}`}
            onClick={() =>
              !(busy && !!session_id && !session_id.toString().startsWith('manual_')) &&
              this.props.navigate(`/devices/${udid}/control`)
            }
            disabled={busy && !!session_id && !session_id.toString().startsWith('manual_')}
            title={busy && !!session_id && !session_id.toString().startsWith('manual_') ? 'Locked: Appium Session' : 'Take Control'}
          >
            <Monitor size={14} />
            <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em', fontFamily: 'Outfit, sans-serif' }}>CTRL</span>
          </button>
        </div>

        {/* Modals */}
        {this.state.showReservation && (
          <ReservationModal
            device={this.props.device}
            onClose={() => this.setState({ showReservation: false })}
            onReserved={() => this.props.reloadDevices()}
          />
        )}
        {this.state.showTagManager && (
          <TagManagerModal
            device={this.props.device}
            onClose={() => this.setState({ showTagManager: false })}
            onUpdated={() => this.props.reloadDevices()}
          />
        )}
      </div>
    );
  }
}

export default function DeviceCardWrapper(props: any) {
  const navigate = useNavigate();
  return <DeviceCard {...props} navigate={navigate} />;
}
