import * as React from 'react';

export interface InPlaceDialogProps extends React.HTMLAttributes<HTMLDivElement> {
  /** id of the visible heading that names the dialog. */
  labelledBy: string;
  onClose: () => void;
  children: React.ReactNode;
}

// Escape in a field usually means "clear" or "cancel this input", not "leave".
const TYPING_TAGS = /^(INPUT|TEXTAREA|SELECT)$/;

/** Returns true when it has taken the close over (to ask first, say). */
type CloseGuard = () => boolean;

interface DialogClose {
  register(guard: CloseGuard): () => void;
  /** Closes unless a guard takes it over. */
  close(): void;
}

const DialogCloseContext = React.createContext<DialogClose | null>(null);

/**
 * While `guard` is set, every close of the enclosing InPlaceDialog (Escape,
 * or a close through useDialogClose) asks it first. Returning true keeps the
 * dialog open: the guard has taken over, for instance to confirm. Outside a
 * dialog it does nothing.
 */
export function useCloseGuard(guard: CloseGuard | null): void {
  const ctx = React.useContext(DialogCloseContext);
  const guardRef = React.useRef(guard);
  guardRef.current = guard;
  const active = guard !== null;
  React.useEffect(() => {
    if (!ctx || !active) return;
    return ctx.register(() => guardRef.current?.() ?? false);
  }, [ctx, active]);
}

/**
 * A close for a child's own close button that the dialog's guards see, as they
 * see Escape. Outside an InPlaceDialog it is `fallback`.
 */
export function useDialogClose(fallback: () => void): () => void {
  const ctx = React.useContext(DialogCloseContext);
  const fallbackRef = React.useRef(fallback);
  fallbackRef.current = fallback;
  return React.useCallback(() => (ctx ? ctx.close() : fallbackRef.current()), [ctx]);
}

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
 * (autoFocus). Escape closes, except while typing in a field, and unless a
 * child's close guard (useCloseGuard) takes the close over. On close, focus
 * returns to the element that had it before, typically the button that opened it.
 */
export function InPlaceDialog({
  labelledBy,
  onClose,
  children,
  style,
  ...rest
}: InPlaceDialogProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  const closeApi = React.useMemo<DialogClose>(() => {
    const guards = new Set<CloseGuard>();
    return {
      register(guard) {
        guards.add(guard);
        return () => {
          guards.delete(guard);
        };
      },
      close() {
        for (const guard of Array.from(guards)) if (guard()) return;
        onCloseRef.current();
      },
    };
  }, []);
  const closeRef = React.useRef(closeApi);

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const returnTo = document.activeElement as HTMLElement | null;

    // Every sibling on the path from the dialog up to <body> is background.
    const madeInert: Element[] = [];
    for (
      let el: Element = dialog;
      el.parentElement && el !== document.body;
      el = el.parentElement
    ) {
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
      closeRef.current.close();
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
      <DialogCloseContext.Provider value={closeApi}>{children}</DialogCloseContext.Provider>
    </div>
  );
}
