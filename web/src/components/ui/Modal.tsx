import * as React from 'react';
import './modal.css';

export interface ModalProps {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
}

/**
 * Barebones modal primitive. Click-outside and Esc both trigger onClose.
 * Owner is responsible for preventing body scroll if that matters.
 */
export const Modal: React.FC<ModalProps> = ({
  open,
  title,
  onClose,
  footer,
  children,
  width = 480,
}) => {
  React.useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal
        aria-label={typeof title === 'string' ? title : undefined}
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">{title}</div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
};
