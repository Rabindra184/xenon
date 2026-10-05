import type { DeviceLogLine } from './deviceLogBook';
import { NodeDeviceLogLine, NodeDeviceLogsSource, NodeDeviceLogsSupport } from './nodeDeviceLogs';

/** How often the hub asks a node for a session's new lines. */
export const COLLECT_INTERVAL_MS = 10_000;
/** Answers asked for in one round while the node says it holds more. */
export const MAX_PAGES_PER_ROUND = 10;
/**
 * Failed asks in a row after which the node is taken to be gone, and not
 * asked once more when the session ends. One failure is a busy node, often at
 * the end of a test, and the last ask brings the test's last lines.
 */
export const OUTAGE_AFTER_FAILURES = 2;

/** A line the hub stored before it restarted. */
export interface StoredLine {
  message: string;
  /** ms */
  timestamp: number;
}

export interface NodeDeviceLogsCollectorOptions {
  source: NodeDeviceLogsSource;
  /**
   * The node's new lines, in order. The next ask drops them on the node, so
   * it waits for what this returns: the lines written.
   */
  onLines: (lines: DeviceLogLine[]) => void | Promise<void>;
  support: Pick<NodeDeviceLogsSupport, 'shouldAsk' | 'unsupported'>;
  logger: { info(message: string): void; warn(message: string): void };
  /**
   * After a hub restart: the newest lines it stored, oldest first, which the
   * node may send again.
   */
  storedTail?: StoredLine[];
  intervalMs?: number;
}

const rowOf = (l: NodeDeviceLogLine): DeviceLogLine => ({
  message: l.message,
  timestamp: new Date(l.timestamp),
});

/**
 * On a hub: a session on a node's phone, its device log lines collected by
 * asking the node (GET /node/sessions/:id/device-logs) at once, then every
 * COLLECT_INTERVAL_MS, instead of reading the phone. Asking at once tells the
 * node a hub wants the session's lines (it stops recording a session nobody
 * asks about). While the node holds more than one answer, it is asked again at
 * once. Asks never overlap. An unreachable node is asked again; whether the
 * session is alive is the heartbeat's call. When the session ends it asks
 * once more, for the last lines, unless the node stopped answering
 * (OUTAGE_AFTER_FAILURES).
 */
export class NodeDeviceLogsCollector {
  /** The newest line's `seq` the hub has. */
  private after: number | null = null;
  private done = false;
  private timer?: ReturnType<typeof setInterval>;
  private asking: Promise<void> | null = null;
  private outage = false;
  /** Failed asks in a row. */
  private failures = 0;
  private storedTail: StoredLine[];

  constructor(private readonly o: NodeDeviceLogsCollectorOptions) {
    this.storedTail = o.storedTail ?? [];
  }

  start(): void {
    const origin = this.o.source.nodeOrigin();
    if (!origin || !this.o.support.shouldAsk(origin)) {
      this.finish();
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.o.intervalMs ?? COLLECT_INTERVAL_MS);
    this.timer.unref?.();
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.asking) await this.asking;
    // No last ask of a node that stopped answering: ending each of a dark
    // node's sessions would wait out another timeout for nothing.
    if (!this.done && this.failures < OUTAGE_AFTER_FAILURES) await this.round();
    this.done = true;
  }

  private tick(): Promise<void> | undefined {
    if (this.done || this.asking) return undefined;
    this.asking = this.round().finally(() => {
      this.asking = null;
    });
    return this.asking;
  }

  /** Asks until the node has nothing more to give, at most MAX_PAGES_PER_ROUND times. */
  private async round(): Promise<void> {
    for (let page = 0; page < MAX_PAGES_PER_ROUND; page++) {
      if (!(await this.ask())) return;
    }
  }

  /** One ask; true when the node holds more, to ask for at once. */
  private async ask(): Promise<boolean> {
    const reply = await this.o.source.nodeDeviceLogs(this.after);
    switch (reply.kind) {
      case 'answer': {
        this.failures = 0;
        if (this.outage) {
          this.outage = false;
          this.o.logger.info(`${this.o.source.nodeOrigin()} answers again`);
        }
        const after = this.after;
        const lines = reply.answer.lines.filter((l) => after === null || l.seq > after);
        for (const l of lines) this.after = Math.max(this.after ?? 0, l.seq);
        const fresh = this.pastStored(lines);
        if (fresh.length > 0) await this.o.onLines(fresh.map(rowOf));
        if (reply.answer.more && lines.length > 0) return true;
        if (reply.answer.state !== 'recording') this.finish();
        return false;
      }
      case 'unsupported':
        this.o.support.unsupported(this.o.source.nodeOrigin() ?? '', reply.status);
        this.finish();
        return false;
      case 'refused':
        this.finish();
        return false;
      case 'unavailable':
        this.failures += 1;
        if (!this.outage) {
          this.outage = true;
          this.o.logger.warn(
            `Can't collect device logs from ${this.o.source.nodeOrigin()}: ${reply.reason}. Asking again.`,
          );
        }
        return false;
    }
  }

  /**
   * After a hub restart the node still holds the last page the hub received
   * (it drops lines only when the next ask names them), so the first answer
   * can repeat lines the hub stored. They end where the answer's lines match
   * the stored tail, line for line back from there: logcat often prints the
   * same line twice in one millisecond, so one line alone can't say which
   * copy the hub has.
   */
  private pastStored(lines: NodeDeviceLogLine[]): NodeDeviceLogLine[] {
    const tail = this.storedTail;
    if (tail.length === 0) return lines;
    this.storedTail = [];
    const same = (l: NodeDeviceLogLine, t: StoredLine) =>
      l.message === t.message && l.timestamp === t.timestamp;
    for (let end = lines.length - 1; end >= 0; end -= 1) {
      const span = Math.min(tail.length, end + 1);
      let k = 0;
      while (k < span && same(lines[end - k], tail[tail.length - 1 - k])) k += 1;
      if (k === span) return lines.slice(end + 1);
    }
    return lines;
  }

  private finish(): void {
    this.done = true;
    if (this.timer) clearInterval(this.timer);
  }
}
