import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
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
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className="pointer-events-auto flex items-center gap-2 rounded-md border border-line-strong bg-surface2 px-3 py-2 text-sm text-ink shadow-lg"
        >
          {t.kind === 'success' ? (
            <CheckCircle2 size={14} className="text-accent" />
          ) : (
            <XCircle size={14} className="text-danger" />
          )}
          {t.message}
        </button>
      ))}
    </div>
  );
}
