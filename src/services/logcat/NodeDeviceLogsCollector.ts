import type { DeviceLogLine } from './deviceLogBook';
import { NodeDeviceLogLine, NodeDeviceLogsSource, NodeDeviceLogsSupport } from './nodeDeviceLogs';

/** How often the hub asks a node for a session's new lines. */
export const COLLECT_INTERVAL_MS = 10_000;
/** Answers asked for in one round while the node says it holds more. */
export const MAX_PAGES_PER_ROUND = 10;

/** The newest line the hub stored before it restarted. */
export interface StoredLine {
  message: string;
  /** ms */
  timestamp: number;
}

export interface NodeDeviceLogsCollectorOptions {
  source: NodeDeviceLogsSource;
  /** The node's new lines, in order. */
  onLines: (lines: DeviceLogLine[]) => void;
  support: Pick<NodeDeviceLogsSupport, 'shouldAsk' | 'unsupported'>;
  logger: { info(message: string): void; warn(message: string): void };
  /** After a hub restart: the newest line it stored, which the node may send again. */
  newestStored?: StoredLine | null;
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
 * once more, for the last lines, unless the node wasn't answering.
 */
export class NodeDeviceLogsCollector {
  /** The newest line's `seq` the hub has. */
  private after: number | null = null;
  private done = false;
  private timer?: ReturnType<typeof setInterval>;
  private asking: Promise<void> | null = null;
  private outage = false;
  private newestStored: StoredLine | null;

  constructor(private readonly o: NodeDeviceLogsCollectorOptions) {
    this.newestStored = o.newestStored ?? null;
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
    // No last ask of a node that wasn't answering: ending each of a dark
    // node's sessions would wait out another timeout for nothing.
    if (!this.done && !this.outage) await this.round();
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
        if (this.outage) {
          this.outage = false;
          this.o.logger.info(`${this.o.source.nodeOrigin()} answers again`);
        }
        const after = this.after;
        const lines = reply.answer.lines.filter((l) => after === null || l.seq > after);
        for (const l of lines) this.after = Math.max(this.after ?? 0, l.seq);
        const fresh = this.pastStored(lines);
        if (fresh.length > 0) this.o.onLines(fresh.map(rowOf));
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
   * can repeat lines the hub stored: those up to the newest stored go.
   */
  private pastStored(lines: NodeDeviceLogLine[]): NodeDeviceLogLine[] {
    const stored = this.newestStored;
    if (!stored) return lines;
    this.newestStored = null;
    let i = lines.length - 1;
    while (
      i >= 0 &&
      (lines[i].message !== stored.message || lines[i].timestamp !== stored.timestamp)
    ) {
      i -= 1;
    }
    return lines.slice(i + 1);
  }

  private finish(): void {
    this.done = true;
    if (this.timer) clearInterval(this.timer);
  }
}
