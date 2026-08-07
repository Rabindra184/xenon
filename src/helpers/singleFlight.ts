/**
 * Deduplicates concurrent async work per key: while a task for a key is in
 * flight, later callers get the same promise instead of starting a second one.
 *
 * Why this exists as a helper rather than an inline Map: the stream services
 * hand-rolled this and got the ordering wrong (issue #194).
 *
 *   const promise = performStartup();       // async body runs synchronously
 *                                           // until its first `await`
 *   this.startPromises.set(udid, promise);  // registration happens after
 *
 * with cleanup in the task's own `finally`. On a path that returned without
 * ever awaiting, the whole body — cleanup included — ran during the call, so
 * the key was deleted *before* it was ever set. The map was then left holding
 * an already-settled promise, and every subsequent call short-circuited to a
 * stale result for the life of the process. On Android that meant recording
 * silently produced 0-byte files until the server restarted.
 *
 * Here the key is registered before the release is scheduled, and the release
 * runs in a microtask via `.then(...)`, so it can never precede registration no
 * matter how the task settles. The identity check on release keeps a slow
 * task's cleanup from evicting a newer entry for the same key.
 */
export class SingleFlight<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  /**
   * Run `task` for `key`, or join the one already running.
   * The caller always receives the task's own promise, so rejections surface
   * normally.
   */
  run(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = task();
    this.inFlight.set(key, promise);

    const release = () => {
      // Only clear our own entry — a newer run for this key must survive.
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    };
    // Two handlers rather than .finally() so the derived promise never becomes
    // an unhandled rejection; the original `promise` is what we return.
    void promise.then(release, release);

    return promise;
  }

  /** Whether a task is currently in flight for this key. */
  has(key: string): boolean {
    return this.inFlight.has(key);
  }

  /** Number of in-flight tasks. */
  get size(): number {
    return this.inFlight.size;
  }
}
