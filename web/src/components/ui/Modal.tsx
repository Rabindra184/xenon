import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import './modal.css';

export interface ModalProps {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  title,
  onClose,
  footer,
  children,
  width = 480,
}) => {
  // Track the element that had focus before the dialog opened so we can
  // restore it on close. Radix's built-in restoration is unreliable in
  // React 17 / JSDOM due to the setTimeout(0) race with document focusin
  // listeners still active at the point the scheduled callback fires.
  const returnFocusRef = React.useRef<Element | null>(null);

  React.useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement;
    }
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        {/* onClick fires synchronously; Radix's pointer-outside path is async */}
        <DialogPrimitive.Overlay className="modal-overlay" onClick={onClose} />
        <DialogPrimitive.Content
          className="modal"
          style={{ width }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const el = returnFocusRef.current;
            if (el && 'focus' in el) {
              (el as HTMLElement).focus();
            }
          }}
        >
          <DialogPrimitive.Title asChild>
            <div className="modal-header">{title}</div>
          </DialogPrimitive.Title>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
