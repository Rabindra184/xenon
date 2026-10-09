import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { UI_COPY } from '../../copy/ui';
import { dismissToast, subscribeToasts, type Toast } from './toastStore';

function ToastCard({ toast: t }: { toast: Toast }) {
  return (
    // The whole toast closes on a click. The ✕ on an error toast, which stays
    // until closed, is the visible way in and the one a keyboard can reach
    // (a button cannot hold another button, so the toast itself is a div).
    <div
      onClick={() => dismissToast(t.id)}
      className="pointer-events-auto flex max-w-sm cursor-pointer items-start gap-2 rounded-md border border-line-strong bg-surface2 px-3 py-2 text-left text-sm text-ink shadow-md"
    >
      {t.kind === 'success' ? (
        <CheckCircle2 size={14} aria-hidden="true" className="mt-1 shrink-0 text-accent" />
      ) : (
        <AlertTriangle size={14} aria-hidden="true" className="mt-1 shrink-0 text-danger" />
      )}
      <span className="min-w-0 break-words">{t.message}</span>
      {t.kind === 'error' && (
        <button
          type="button"
          aria-label={UI_COPY.dismiss}
          title={UI_COPY.dismiss}
          onClick={(e) => {
            e.stopPropagation();
            dismissToast(t.id);
          }}
          className="focus-ring -my-0.5 -mr-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:text-ink"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/**
 * Toasts, in two live regions that are always on the page (a region has to
 * exist before its content changes for a screen reader to announce it): errors
 * in an alert, announced at once, and everything else in a status, announced
 * politely. `data-toaster` lets a modal window tell a click on a toast from a
 * click outside it.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);

  return (
    <div data-toaster className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      <div role="status" aria-live="polite" className="flex flex-col items-end gap-2">
        {toasts
          .filter((t) => t.kind !== 'error')
          .map((t) => (
            <ToastCard key={t.id} toast={t} />
          ))}
      </div>
      <div role="alert" aria-live="assertive" className="flex flex-col items-end gap-2">
        {toasts
          .filter((t) => t.kind === 'error')
          .map((t) => (
            <ToastCard key={t.id} toast={t} />
          ))}
      </div>
    </div>
  );
}
