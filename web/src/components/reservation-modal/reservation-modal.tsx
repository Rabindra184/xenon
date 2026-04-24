import React, { useState } from 'react';
import './reservation-modal.css';
import { Clock, User, MessageSquare, AlertCircle, CalendarPlus } from 'lucide-react';
import XenonApiService from '../../api-service';
import { IDevice } from '../../interfaces/IDevice';
import { Modal } from '../ui/Modal';
import { FieldGroup } from '../ui/FieldGroup';

interface ReservationModalProps {
  device: IDevice;
  onClose: () => void;
  onReserved: () => void;
}

const DURATION_OPTIONS = [
  { label: '1 Hour', value: '1h' },
  { label: '2 Hours', value: '2h' },
  { label: '4 Hours', value: '4h' },
  { label: '8 Hours', value: '8h' },
];

const ReservationModal: React.FC<ReservationModalProps> = ({ device, onClose, onReserved }) => {
  const [reservedBy, setReservedBy] = useState('');
  const [duration, setDuration] = useState('1h');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleReserve = async () => {
    if (!reservedBy.trim()) {
      setNameError('Please enter your name/ID');
      return;
    }

    setLoading(true);
    setNameError(null);
    setSubmitError(null);

    try {
      const response = await XenonApiService.reserveDevice(
        device.udid,
        device.host,
        reservedBy,
        duration,
        reason,
      );

      if (response.success) {
        onReserved();
        onClose();
      } else {
        setSubmitError(response.error || 'Failed to reserve device');
      }
    } catch (err: any) {
      setSubmitError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      width={520}
      title={
        <>
          <CalendarPlus size={16} className="title-icon" />
          Reserve Device
        </>
      }
      footer={
        <>
          <button className="btn-cancel" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn-reserve"
            onClick={handleReserve}
            disabled={loading || !reservedBy.trim()}
          >
            {loading ? 'Reserving...' : 'Confirm Reservation'}
          </button>
        </>
      }
    >
      <div className="reservation-modal-body">
        <div className="device-id-badge">
          <span className="label">Device:</span>
          <span className="value">{device.udid}</span>
        </div>

        <p>
          Reserve <strong>{device.name || device.udid}</strong> for exclusive use. This will
          prevent CI sessions from using this device.
        </p>

        <FieldGroup
          label={
            <>
              <User
                size={14}
                style={{ marginRight: 6, verticalAlign: 'middle', color: 'var(--accent)' }}
              />
              Reserved By
            </>
          }
          htmlFor="reservation-reserved-by"
          error={
            nameError ? (
              <>
                <AlertCircle size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                {nameError}
              </>
            ) : undefined
          }
        >
          <input
            id="reservation-reserved-by"
            type="text"
            className="reservation-input"
            placeholder="Enter your name or ID"
            value={reservedBy}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setReservedBy(e.target.value);
              if (nameError) setNameError(null);
            }}
            disabled={loading}
          />
        </FieldGroup>

        <FieldGroup
          label={
            <>
              <Clock
                size={14}
                style={{ marginRight: 6, verticalAlign: 'middle', color: 'var(--accent)' }}
              />
              Duration
            </>
          }
        >
          <div className="duration-selector">
            {DURATION_OPTIONS.map((opt) => (
              <div
                key={opt.value}
                className={`duration-option ${duration === opt.value ? 'active' : ''}`}
                onClick={() => setDuration(opt.value)}
              >
                {opt.label}
              </div>
            ))}
          </div>
        </FieldGroup>

        <FieldGroup
          label={
            <>
              <MessageSquare
                size={14}
                style={{ marginRight: 6, verticalAlign: 'middle', color: 'var(--accent)' }}
              />
              Reason (Optional)
            </>
          }
          htmlFor="reservation-reason"
          error={
            submitError ? (
              <>
                <AlertCircle size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                {submitError}
              </>
            ) : undefined
          }
        >
          <input
            id="reservation-reason"
            type="text"
            className="reservation-input"
            placeholder="e.g., Debugging flaky login test"
            value={reason}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)}
            disabled={loading}
          />
        </FieldGroup>
      </div>
    </Modal>
  );
};

export default ReservationModal;
