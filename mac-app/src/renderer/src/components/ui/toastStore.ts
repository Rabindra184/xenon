// Tiny module-level toast store: any code calls toast(); the Toaster
// component subscribes and renders. No context, no library.

export type ToastKind = 'success' | 'error';
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

const AUTO_DISMISS_MS = 4000;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<(t: Toast[]) => void>();

function emit(): void {
  for (const l of listeners) l(toasts);
}

export function toast(message: string, kind: ToastKind = 'success'): void {
  const t: Toast = { id: nextId++, message, kind };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => dismissToast(t.id), AUTO_DISMISS_MS);
}

export function dismissToast(id: number): void {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) emit();
}

export function subscribeToasts(cb: (t: Toast[]) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Test-only: reset module state between cases. */
export function _resetToasts(): void {
  toasts = [];
  nextId = 1;
}
