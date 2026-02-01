import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import './reservation-modal.css';
import { Clock, User, MessageSquare, AlertCircle } from 'lucide-react';
import XenonApiService from '../../api-service';
import { IDevice } from '../../interfaces/IDevice';

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
  const [error, setError] = useState<string | null>(null);

  const handleReserve = async () => {
    if (!reservedBy.trim()) {
      setError('Please enter your name/ID');
      return;
    }

    setLoading(true);
    setError(null);

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
        setError(response.error || 'Failed to reserve device');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="reservation-modal-overlay" onClick={onClose}>
      <div className="reservation-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Reserve Device</h2>
        <p>
          Reserve <strong>{device.name || device.udid}</strong> for exclusive use. This will prevent
          CI sessions from using this device.
        </p>

        <div className="reservation-form-group">
          <label>
            <User size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Reserved By
          </label>
          <input
            type="text"
            className="reservation-input"
            placeholder="Enter your name or ID"
            value={reservedBy}
            onChange={(e) => setReservedBy(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="reservation-form-group">
          <label>
            <Clock size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Duration
          </label>
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
        </div>

        <div className="reservation-form-group">
          <label>
            <MessageSquare size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Reason (Optional)
          </label>
          <input
            type="text"
            className="reservation-input"
            placeholder="e.g., Debugging flaky login test"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={loading}
          />
        </div>

        {error && (
          <div className="error-message">
            <AlertCircle size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {error}
          </div>
        )}

        <div className="reservation-actions">
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
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ReservationModal;
