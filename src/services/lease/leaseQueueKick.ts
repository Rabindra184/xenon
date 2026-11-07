/**
 * "A phone may have come free": a lease released, expired or ended, a session
 * released, a hold dropped, a node reporting a phone free, a phone added or
 * healthy again. The lease queue (LeaseQueue.start) listens and runs a grant
 * pass soon.
 *
 * No imports, so any module can call it without an import cycle: the writers
 * that free phones sit below the lease services that would otherwise import
 * them.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Tells the listeners a phone may be free. Never throws. */
export function phoneFreed(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A listener's failure is its own; the writer that freed a phone goes on.
    }
  }
}

/** Calls `fn` on every phoneFreed(); the answer unsubscribes. */
export function onPhoneFreed(fn: Listener): () => void {
  // A wrapper per subscription, so subscribing one function twice and
  // unsubscribing once leaves the other subscription in place.
  const listener: Listener = () => fn();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
