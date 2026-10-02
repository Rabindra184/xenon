import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/button';

export const MUTE_REASON_MAX = 500;

interface ConfirmProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const MarkFixedDialog: React.FC<ConfirmProps> = ({ open, busy, onClose, onConfirm }) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Mark this selector fixed?"
    footer={
      <>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={busy}>
          Mark fixed
        </Button>
      </>
    }
  >
    <p className="text-sm text-[var(--text-muted)]">
      Xenon watches the next 3 clean builds. If this selector heals again, it goes back to To fix.
    </p>
  </Modal>
);

export const CancelVerificationDialog: React.FC<ConfirmProps> = ({
  open,
  busy,
  onClose,
  onConfirm,
}) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Cancel verification?"
    footer={
      <>
        <Button variant="secondary" onClick={onClose}>
          Keep verifying
        </Button>
        <Button onClick={onConfirm} disabled={busy}>
          Cancel verification
        </Button>
      </>
    }
  >
    <p className="text-sm text-[var(--text-muted)]">
      The selector goes back to To fix, and its clean builds start again from zero.
    </p>
  </Modal>
);

export const MuteDialog: React.FC<{
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}> = ({ open, busy, onClose, onConfirm }) => {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mute this selector?"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(reason.trim())} disabled={busy}>
            Mute
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-[var(--text-muted)]">
        A muted selector is left out of this list, the CI gate and the digest, for everyone, until
        someone unmutes it.
      </p>
      <label htmlFor="mute-reason" className="block text-xs font-medium text-[var(--text)]">
        Reason (optional)
      </label>
      <textarea
        id="mute-reason"
        value={reason}
        maxLength={MUTE_REASON_MAX}
        rows={3}
        placeholder="Screen being redesigned"
        onChange={(e) => setReason(e.target.value)}
        className="mt-1 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]"
      />
      <div className="mt-1 text-right text-[11px] tabular-nums text-[var(--text-dim)]">
        {reason.length}/{MUTE_REASON_MAX}
      </div>
    </Modal>
  );
};
