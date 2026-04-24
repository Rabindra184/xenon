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
  // Capture the focused element before the dialog opens so we can restore it
  // on close. Radix FocusScope calls focus(previouslyFocusedElement) inside a
  // setTimeout(0) on unmount, but in JSDOM the element it captures at mount
  // time is already wrong: fireEvent.click() does not keep the clicked element
  // as activeElement across the synchronous React re-render that opens the
  // dialog, so FocusScope records the wrong element. We save it one render
  // earlier (while open is still false) and restore it ourselves via
  // onCloseAutoFocus, which lets us preventDefault() on Radix's built-in
  // restoration attempt and supply the correct target instead.
  // This workaround can be removed once: (a) all modal tests use
  // @testing-library/user-event (which correctly tracks activeElement), or
  // (b) JSDOM updates activeElement synchronously on fireEvent.click.
  const returnFocusRef = React.useRef<Element | null>(null);

  React.useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement;
    }
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="modal-overlay" />
        <DialogPrimitive.Content
          className="modal"
          style={{ width }}
          aria-describedby={undefined}
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
