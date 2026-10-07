import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { dismissToast, subscribeToasts, type Toast } from './toastStore';

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);

  return (
    <div
      className="pointer-events-none fixed bottom-14 right-4 z-[60] flex flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        // The whole toast closes on a click. The ✕ on an error toast, which stays
        // until closed, is the visible way in and the one a keyboard can reach
        // (a button cannot hold another button, so the toast itself is a div).
        <div
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className="pointer-events-auto flex max-w-sm cursor-pointer items-start gap-2 rounded-md border border-line-strong bg-surface2 px-3 py-2 text-left text-sm text-ink shadow-lg"
        >
          {t.kind === 'success' ? (
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-accent" />
          ) : (
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
          )}
          <span className="min-w-0 break-words">{t.message}</span>
          {t.kind === 'error' && (
            <button
              type="button"
              aria-label="Dismiss"
              title="Dismiss"
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(t.id);
              }}
              className="focus-ring -mr-1 ml-1 mt-px shrink-0 rounded p-0.5 text-muted hover:text-ink"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
