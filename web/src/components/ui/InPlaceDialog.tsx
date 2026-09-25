import * as React from 'react';

export interface InPlaceDialogProps extends React.HTMLAttributes<HTMLDivElement> {
  /** id of the visible heading that names the dialog. */
  labelledBy: string;
  onClose: () => void;
  children: React.ReactNode;
}

// Escape in a field usually means "clear" or "cancel this input", not "leave".
const TYPING_TAGS = /^(INPUT|TEXTAREA|SELECT)$/;

/**
 * A modal dialog rendered where it sits in the tree rather than in a portal,
 * for full-screen views that are also routes (device control).
 *
 * Radix's modal Dialog hides and blocks everything outside it, which would
 * silence the toast live region and make toast buttons unclickable while the
 * view is open. This uses the `inert` attribute instead, on the background only:
 * the rest of the app can't be focused, clicked or read by a screen reader, but
 * live regions (toasts) and anything opened later (portaled popovers, confirm
 * dialogs) stay usable. Because the background is inert, Tab can't leave the
 * dialog, so no focus trap is needed.
 *
 * On open, focus moves into the dialog unless a child already took it
 * (autoFocus). Escape closes, except while typing in a field. On close, focus
 * returns to the element that had it before, typically the button that opened it.
 */
export function InPlaceDialog({ labelledBy, onClose, children, style, ...rest }: InPlaceDialogProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const returnTo = document.activeElement as HTMLElement | null;

    // Every sibling on the path from the dialog up to <body> is background.
    const madeInert: Element[] = [];
    for (let el: Element = dialog; el.parentElement && el !== document.body; el = el.parentElement) {
      for (const sibling of Array.from(el.parentElement.children)) {
        if (sibling === el || sibling.hasAttribute('inert')) continue;
        if (sibling.matches('[aria-live], script, style, link, template')) continue;
        sibling.setAttribute('inert', '');
        madeInert.push(sibling);
      }
    }

    if (!dialog.contains(document.activeElement)) dialog.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement;
      if (TYPING_TAGS.test(target.tagName) || target.isContentEditable) return;
      e.preventDefault();
      onCloseRef.current();
    };
    dialog.addEventListener('keydown', onKeyDown);

    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      madeInert.forEach((el) => el.removeAttribute('inert'));
      if (returnTo && returnTo.isConnected && returnTo !== document.body) returnTo.focus();
    };
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      // The container takes focus only so the dialog is announced; it isn't a
      // control, so it doesn't draw a ring around the whole view.
      style={{ outline: 'none', ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
