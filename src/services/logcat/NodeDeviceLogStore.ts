import { Service } from 'typedi';
import type { DeviceLogLine } from './deviceLogBook';
import {
  NODE_DEVICE_LOGS_KEEP_AFTER_END_MS,
  NODE_DEVICE_LOG_PAGE,
  NodeDeviceLogLine,
  NodeDeviceLogsAnswer,
} from './nodeDeviceLogs';

interface Entry {
  /** In the order they were kept; `seq` counts up from 1. */
  lines: NodeDeviceLogLine[];
  nextSeq: number;
  state: 'recording' | 'ended';
  /** A hub has asked about the session. */
  claimed: boolean;
  endedAt: number | null;
}

/**
 * On a node: each recorded session's device log lines, held in memory until
 * the hub collects them. A node has no Session row for a session its hub
 * created, so it can't write them to Log. The session's DeviceLogBook bounds
 * how many there can be; what the hub has collected is dropped; an ended
 * session is kept NODE_DEVICE_LOGS_KEEP_AFTER_END_MS, then forgotten,
 * whether or not a hub asked.
 */
@Service()
export class NodeDeviceLogStore {
  now: () => number = () => Date.now();
  private readonly entries = new Map<string, Entry>();

  begin(sessionId: string): void {
    this.prune();
    this.entries.set(sessionId, {
      lines: [],
      nextSeq: 1,
      state: 'recording',
      claimed: false,
      endedAt: null,
    });
  }

  add(sessionId: string, rows: DeviceLogLine[]): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    for (const row of rows) {
      entry.lines.push({
        seq: entry.nextSeq++,
        message: row.message,
        timestamp: row.timestamp.getTime(),
      });
    }
  }

  end(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.state = 'ended';
    entry.endedAt = this.now();
  }

  /** Drops the session at once: it isn't recorded any more. */
  forget(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  /** Whether a hub has asked about the session. */
  claimed(sessionId: string): boolean {
    return this.entries.get(sessionId)?.claimed === true;
  }

  /**
   * Up to `limit` lines after `after` (from the first, without it). Those at
   * or before it the hub has, so they go.
   */
  read(
    sessionId: string,
    after: number | null,
    limit = NODE_DEVICE_LOG_PAGE,
  ): NodeDeviceLogsAnswer {
    this.prune();
    const entry = this.entries.get(sessionId);
    if (!entry) return { state: 'off', lines: [], more: false };
    entry.claimed = true;
    if (after !== null) {
      const keep = entry.lines.findIndex((l) => l.seq > after);
      entry.lines.splice(0, keep === -1 ? entry.lines.length : keep);
    }
    return {
      state: entry.state,
      lines: entry.lines.slice(0, limit),
      more: entry.lines.length > limit,
    };
  }

  private prune(): void {
    const cutoff = this.now() - NODE_DEVICE_LOGS_KEEP_AFTER_END_MS;
    for (const [id, entry] of this.entries) {
      if (entry.endedAt !== null && entry.endedAt <= cutoff) this.entries.delete(id);
    }
  }
}
