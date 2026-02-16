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
      if (busy) {
        return;
      }

      const isReserved = this.isReserved();

      if (isReserved) {
        return (
          <button
            className="device-info-card__body_unblock-device"
            onClick={() => this.releaseReservation(udid, host)}
            title={`Reserved by ${reservedBy}${reservationReason ? `: ${reservationReason}` : ''
              }. Expires: ${reservedUntil ? new Date(reservedUntil).toLocaleString() : 'Never'}`}
          >
            <Unlock
              size={16}
              className="device-info-card__body_block-device-icon"
              color="var(--accent-blue)"
            />
            {this.getRemainingReservationTime()
              ? `Release (${this.getRemainingReservationTime()})`
              : 'Release Reservation'}
          </button>
        );
      }

      if (!userBlocked) {
        return (
          <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
            <button
              className="device-info-card__body_block-device"
              style={{ flex: 1 }}
              onClick={() => this.setState({ showReservation: true })}
            >
              <Clock
                size={16}
                className="device-info-card__body_block-device-icon"
                color="var(--accent-blue)"
              />
              Reserve
            </button>
            <button
              className="device-info-card__body_block-device"
              style={{ flex: 1 }}
              onClick={() => this.blockDevice(udid, host)}
            >
              <XCircle
                size={16}
                className="device-info-card__body_block-device-icon"
                color="var(--primary)"
              />
              Maintenance
            </button>
          </div>
        );
      } else {
        return (
          <button
            className="device-info-card__body_unblock-device"
            onClick={() => this.unblockDevice(udid, host)}
          >
            <XCircle
              size={16}
              className="device-info-card__body_block-device-icon"
              color="var(--status-error)"
            />
            Exit Maintenance
          </button>
        );
      }
    };

    return (
      <div className={`device-info-card-container ${this.getStatusClassName()}`}>
        <div
          className={`device-state ${deviceState} ${deviceState === 'busy' && sessionProgress && sessionProgress !== 'Session Active'
              ? 'progress-active'
              : ''
            }`}
        >
          {deviceState === 'busy' && sessionProgress && sessionProgress !== 'Session Active'
            ? sessionProgress
            : deviceState}
        </div>
        <div className="device-info-card-container__title_wrapper">
          <div className="code device-info-card-container__device-title" title={udid}>
            {udid}
          </div>
          {['ios', 'tvos'].includes(platform) ? (
            <AppleIcon
              size={18}
              color="var(--status-offline)"
              className="device-info-card-container__device-icon"
            />
          ) : (
            <AndroidIcon
              size={18}
              color="var(--status-offline)"
              className="device-info-card-container__device-icon"
            />
          )}
        </div>
        <div className="device-info-card-container__body">
          <div className="device-info-card-container__body_row">
            <div className="device-info-card-container__body_row_label">Version:</div>
            <div className="device-info-card-container__body_row_value" title={sdk}>
              {sdk}
            </div>
          </div>
          <div className="device-info-card-container__body_row">
            <div className="device-info-card-container__body_row_label">Name:</div>
            <div className="device-info-card-container__body_row_value" title={name}>
              {name}
            </div>
          </div>
          <div className="device-info-card-container__body_row">
            <div className="device-info-card-container__body_row_label">Device Type:</div>
            <div className="device-info-card-container__body_row_value" title={deviceType}>
              {deviceType}
            </div>
          </div>
          <div className="device-info-card-container__body_row">
            <div className="device-info-card-container__body_row_label">Device Location:</div>
            <div className="device-info-card-container__body_row_value" title={hostName}>
              {hostName}
            </div>
          </div>
          <div className="device-info-card-container__body_row">
            <div className="device-info-card-container__body_row_label">Health:</div>
            <div
              className={`device-info-card-container__body_row_value health-status ${this.props.device.healthStatus?.toLowerCase() || 'healthy'
                }`}
              title={this.props.device.healthCheckError || 'Device is healthy'}
            >
              <span className="health-status-dot"></span>
              {this.props.device.healthStatus || 'Healthy'}
              {totalHealedCount && totalHealedCount > 0 ? (
                <span
                  className="healed-count-badge"
                  title={`Autonomous Watchdog healed this device ${totalHealedCount} times`}
                >
                  <ShieldCheck size={10} style={{ marginRight: '2px' }} />
                  {totalHealedCount > 99 ? '99+' : totalHealedCount}
                </span>
              ) : null}
            </div>
          </div>

          <div className="device-info-card-container__body_row">
            <div className="device-info-card-container__body_row_label">Tags:</div>
            <div className="device-tags-container">
              {tags && tags.length > 0 ? (
                tags.map((tag: string) => (
                  <span key={tag} className="device-tag-pill" onClick={() => this.manageTags()}>
                    {tag}
                  </span>
                ))
              ) : (
                <span className="no-tags">No tags</span>
              )}
              <button className="add-tag-btn" onClick={() => this.manageTags()}>
                <Plus size={10} />
              </button>
            </div>
          </div>

          <div className="device-health-metrics">
            {batteryLevel !== undefined && (
              <div className="health-metric" title={`Battery: ${batteryLevel}%`}>
                <div className={`battery-level-indicator ${batteryLevel < 20 ? 'low' : ''}`}>
                  <div className="battery-level-fill" style={{ width: `${batteryLevel}%` }}></div>
                </div>
                <span>{batteryLevel}%</span>
              </div>
            )}
            {thermalStatus && thermalStatus !== 'Normal' && (
              <div
                className={`health-metric thermal-metric ${thermalStatus?.toLowerCase() || ''}`}
                title={`Thermal: ${thermalStatus}`}
              >
                <Thermometer size={12} />
                <span>{thermalStatus?.toUpperCase() || ''}</span>
              </div>
            )}
            {storageFree && storageFree !== 'Unknown' && (
              <div className="health-metric storage-metric" title={`Free Space: ${storageFree}`}>
                <HardDrive size={12} />
                <span>{storageFree}</span>
              </div>
            )}
          </div>

          {totalUtilizationTimeMilliSec != null && (
            <div className="device-info-card-container__body_row">
              <div className="device-info-card-container__body_row_label">Utilization:</div>
              <div
                className="device-info-card-container__body_row_value"
                title={prettyMilliseconds(totalUtilizationTimeMilliSec)}
              >
                {prettyMilliseconds(totalUtilizationTimeMilliSec)}
              </div>
            </div>
          )}

          {this.isReserved() && (
            <div className="reservation-details-section">
              <div className="device-info-card-container__body_row reservation-row">
                <div className="device-info-card-container__body_row_label">Reserved By:</div>
                <div className="device-info-card-container__body_row_value highlight-value">
                  {reservedBy || 'Anonymous'}
                </div>
              </div>
              {reservationReason && (
                <div className="device-info-card-container__body_row reservation-row">
                  <div className="device-info-card-container__body_row_label">Reason:</div>
                  <div
                    className="device-info-card-container__body_row_value"
                    title={reservationReason}
                  >
                    {reservationReason}
                  </div>
                </div>
              )}
            </div>
          )}

          {session_id != null && (
            <div className="device-info-card-container__body_row">
              <div className="device-info-card-container__body_row_label">Session ID:</div>
              <div
                className="device-info-card-container__body_row_value"
                title={session_id.toString()}
              >
                {session_id}
              </div>
            </div>
          )}
          {dashboard_link && !!total_session_count && total_session_count > 0 && (
            <div className="dashboard-link-wrapper">
              <div>
                <div className="device-info-card-container__body_row_label">
                  {`Session${total_session_count > 1 ? 's' : ''}:`}
                </div>
              </div>
              <div className="dashboard-link">
                <LinkIcon className="link-icon" />
                <a className="footer-deeplink" href={dashboard_link} target="_blank">
                  Appium Dashboard ({total_session_count})
                </a>
              </div>
            </div>
          )}
        </div>
        <div className="device-info-card-container__footer_wrapper">
          {blockButton()}
          <button
            className={`device-info-card__body_control-device ${busy && !!session_id && !session_id.toString().startsWith('manual_') ? 'disabled' : ''
              }`}
            onClick={() =>
              !(busy && !!session_id && !session_id.toString().startsWith('manual_')) &&
              this.props.navigate(`/devices/${udid}/control`)
            }
            disabled={busy && !!session_id && !session_id.toString().startsWith('manual_')}
            title={
              busy && !!session_id && !session_id.toString().startsWith('manual_')
                ? 'Device is currently busy with Appium session'
                : 'Take manual control'
            }
          >
            <Monitor size={16} className="device-info-card__body_control-device-icon" />
            Control
          </button>
        </div>
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
