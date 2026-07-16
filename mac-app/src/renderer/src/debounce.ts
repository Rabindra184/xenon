/**
 * Trailing-edge debouncer with an explicit flush, so callers can force pending
 * work to land at moments where losing it would be a bug (unmount, profile
 * switch, server start).
 */
export interface Debouncer<A extends unknown[]> {
  call: (...args: A) => void;
  /** Run the pending call now, if any. */
  flush: () => void;
  /** Drop the pending call. */
  cancel: () => void;
}

export function createDebouncer<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debouncer<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return {
    call: (...args: A) => {
      pending = args;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const args_ = pending;
        clear();
        if (args_) fn(...args_);
      }, ms);
    },
    flush: () => {
      if (!pending) return;
      const args = pending;
      clear();
      fn(...args);
    },
    cancel: clear
  };
}
