// Coalesces high-frequency items (log lines) into batches, so a chatty source
// costs a bounded number of downstream emits instead of one per item.
//
// Why this exists: ProcessSupervisor used to `webContents.send` once per log
// line. Appium during server boot / iOS streaming emits a firehose of stdout,
// and per-line IPC floods the Electron main thread's structured-clone +
// enqueue path, stalling the UI for seconds. Batching on the main side caps
// that to one send per `flushMs` (or per `maxBatch` lines, whichever comes
// first), independent of the renderer's own receive-side coalescing.
//
// The scheduler is injectable so the batching logic is unit-testable without
// real timers or Electron.

export interface LogBatcherOptions<T> {
  /** Max time an item waits before its batch is flushed. */
  flushMs: number;
  /** Flush immediately once the buffer reaches this many items. */
  maxBatch: number;
  /** Called with a non-empty batch on every flush. */
  onFlush: (batch: T[]) => void;
  /** Injectable for tests; defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Injectable for tests; defaults to clearTimeout. */
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class LogBatcher<T> {
  private buffer: T[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly cancel: (handle: ReturnType<typeof setTimeout>) => void;

  constructor(private readonly opts: LogBatcherOptions<T>) {
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = opts.cancel ?? ((h) => clearTimeout(h));
  }

  /** Queue an item. Flushes immediately if the buffer hits `maxBatch`. */
  push(item: T): void {
    this.buffer.push(item);
    if (this.buffer.length >= this.opts.maxBatch) {
      this.flush();
      return;
    }
    if (this.timer === null) {
      this.timer = this.schedule(() => {
        this.timer = null;
        this.flush();
      }, this.opts.flushMs);
    }
  }

  /** Emit whatever is buffered now (no-op when empty). Safe to call anytime. */
  flush(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.opts.onFlush(batch);
  }

  /** Cancel any pending flush and drop buffered items (used on teardown). */
  dispose(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    this.buffer = [];
  }
}
