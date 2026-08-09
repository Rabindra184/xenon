import type { LogcatRecord } from '../../services/logcat/logcatParse';

/**
 * One upstream logcat stream fanned out to many WebSocket clients — the log
 * analogue of H264Multiplexer.
 *
 * Join semantics: a new client immediately receives the replay buffer, so
 * opening the Debug Logs tab shows recent history instead of an empty pane.
 * (H264Multiplexer replays the current GOP for the same reason.)
 *
 * Drop semantics differ from video on purpose. H264Multiplexer drops frames
 * silently when a socket is backed up, which is right for video — the picture
 * simply stutters. A missing log line is data loss the reader cannot detect,
 * so a slow client gets a synthetic record in place of what it missed.
 */
export const REPLAY_BUFFER_SIZE = 2000;

interface Client {
  send: (r: LogcatRecord) => void;
  /** False when the socket is backed up; the mux then counts a drop. */
  canAccept: () => boolean;
  /** Told when the upstream is gone for good; see {@link LogcatMultiplexer.close}. */
  onClose?: () => void;
  dropped: number;
}

export class LogcatMultiplexer {
  private clients = new Set<Client>();
  private replay: LogcatRecord[] = [];
  /**
   * When this mux last dropped to zero clients, or `undefined` while at least
   * one is attached.
   *
   * Recorded at the moment the set empties rather than left for the idle
   * watchdog to infer by polling `clientCount`: a poller can only notice
   * emptiness at its own granularity, so the window it measures is the real
   * window plus up to one whole poll interval. Stamping it here makes the poll
   * interval bound detection latency only, not the idle budget itself.
   *
   * A freshly built mux has never had a client, so it counts as empty from
   * construction — otherwise a stream whose only viewer dies mid-handshake
   * would never be reclaimed.
   */
  private emptyAt: number | undefined = Date.now();

  get clientCount(): number {
    return this.clients.size;
  }

  /** When the mux last had zero clients, or `undefined` while one is attached. */
  get emptySince(): number | undefined {
    return this.emptyAt;
  }

  /** Register a client sink. Returns a remover. */
  addClient(
    send: (r: LogcatRecord) => void,
    canAccept: () => boolean,
    onClose?: () => void,
  ): () => void {
    const c: Client = { send, canAccept, onClose, dropped: 0 };
    // Replay BEFORE joining the Set — a throw mid-replay must not leave a
    // phantom client registered with no remover ever handed back to the
    // caller (see the push() catch below for why an unguarded send is
    // dangerous; the same client can throw again once fully joined, but at
    // least the caller then holds a working remover).
    for (const r of this.replay) send(r);
    this.clients.add(c);
    this.emptyAt = undefined;
    return () => {
      // Only a remove that actually removed something may restamp the clock.
      // A remover called twice (a socket that emits both 'close' and 'error'
      // is the ordinary case) would otherwise push the idle deadline out by
      // the gap between the two calls, every time.
      if (!this.clients.delete(c)) return;
      if (this.clients.size === 0) this.emptyAt = Date.now();
    };
  }

  /**
   * The upstream is gone for good: tell every client and detach them all.
   * Callers push their final record BEFORE calling this, so a client learns
   * why it is being closed.
   */
  close(): void {
    for (const c of this.clients) {
      try {
        c.onClose?.();
      } catch {
        // One bad sink must not strand the clients after it in the Set — the
        // same reason push() guards its own send (see below).
      }
    }
    this.clients.clear();
    this.emptyAt = Date.now();
  }

  push(record: LogcatRecord): void {
    this.replay.push(record);
    if (this.replay.length > REPLAY_BUFFER_SIZE) {
      this.replay.splice(0, this.replay.length - REPLAY_BUFFER_SIZE);
    }

    for (const c of this.clients) {
      if (!c.canAccept()) {
        c.dropped += 1;
        continue;
      }
      if (c.dropped > 0) {
        // Report the gap before the record that closes it, so the log reads in
        // order. Coalesced: one record per run of drops, not one per drop.
        // Carry the timestamp of the record that closes the gap (not
        // Date.now()) so the marker sorts correctly among real, device-clock
        // records instead of drifting with server/device clock skew.
        const n = c.dropped;
        // A throwing sink is treated like a refusal: it must not silently
        // vanish or starve clients later in the Set (see the record send
        // below for the matching guard). Only clear the count once the
        // synthetic genuinely got out — a throw leaves it at n so the drop is
        // still reported next time this client accepts something.
        try {
          c.send({
            ts: record.ts,
            pid: 0,
            tid: 0,
            level: 'W',
            tag: 'xenon',
            message: `${n} lines dropped (slow client)`,
            synthetic: true,
          });
          c.dropped = 0;
        } catch {
          /* dropped stays at n; retried on the next accepted send */
        }
      }
      try {
        c.send(record);
      } catch {
        c.dropped += 1;
      }
    }
  }
}
