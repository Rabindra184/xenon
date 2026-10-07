import { useEffect, useRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../cn';
import { UI_COPY } from '../../copy/ui';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The name of the window. Always shown, and what a screen reader announces. */
  title: string;
  description?: string;
  /** Classes for the panel itself, for a width other than the default. */
  className?: string;
  children: ReactNode;
}

/**
 * A modal window, on Radix: Escape closes it, Tab stays inside, the rest of the
 * page is hidden from screen readers while it is open, and focus goes back to
 * whatever was focused when it opened. (Radix only does that last part for its
 * own Trigger, and screens here open dialogs from their own buttons, so the
 * opener is remembered here.)
 *
 * A screen closes a dialog either by turning `open` off or by no longer
 * rendering it. Radix hands focus back on a timer, a tick after the dialog is
 * gone, which only covers the first, so both paths restore it here, at once:
 * when `open` goes off and when the dialog unmounts.
 */
function Modal({ kind, open, onOpenChange, title, description, className, children }: ModalProps & { kind: 'dialog' | 'sheet' }) {
  const opener = useRef<HTMLElement | null>(null);
  const sheet = kind === 'sheet';

  const restoreFocus = () => {
    const element = opener.current;
    opener.current = null;
    if (element?.isConnected) element.focus();
  };
  // restoreFocus only reads a ref, so the first one is as good as any later one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => restoreFocus, []);
  // A dialog that stays mounted while `open` goes off gets the same, in the same commit.
  // (Nothing to restore if it was never open: the opener is only set on opening.)
  useEffect(() => {
    if (!open) restoreFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn('fixed inset-0 z-40 bg-scrim/40', !sheet && 'flex items-center justify-center p-6')}
        >
          <DialogPrimitive.Content
            // No description means no aria-describedby, rather than one pointing nowhere.
            {...(description ? {} : { 'aria-describedby': undefined })}
            onOpenAutoFocus={() => {
              // Focus has not moved in yet, so this is the opener.
              opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              restoreFocus();
            }}
            // A toast is outside the window but not an outside click: using it must not close the window.
            onInteractOutside={(event) => {
              if (event.target instanceof Element && event.target.closest('[data-toaster]')) event.preventDefault();
            }}
            className={cn(
              'flex flex-col overflow-hidden border border-line bg-surface shadow-lg focus:outline-none',
              sheet
                ? 'fixed inset-y-0 right-0 w-full max-w-md rounded-l-lg border-r-0'
                : 'max-h-full w-full max-w-lg rounded-lg',
              className
            )}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-3">
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-sm font-semibold text-ink">{title}</DialogPrimitive.Title>
                {description && (
                  <DialogPrimitive.Description className="mt-0.5 text-xs text-muted">
                    {description}
                  </DialogPrimitive.Description>
                )}
              </div>
              <DialogPrimitive.Close
                aria-label={sheet ? UI_COPY.closePanel : UI_COPY.closeDialog}
                className="focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-surface2 hover:text-ink"
              >
                <X size={16} />
              </DialogPrimitive.Close>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** A centred window for one focused task. */
export function Dialog(props: ModalProps) {
  return <Modal kind="dialog" {...props} />;
}

/** A panel that slides in from the right edge, for a list or a form that sits beside the screen. */
export function Sheet(props: ModalProps) {
  return <Modal kind="sheet" {...props} />;
}
