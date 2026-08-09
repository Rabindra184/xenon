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
  dropped: number;
}

export class LogcatMultiplexer {
  private clients = new Set<Client>();
  private replay: LogcatRecord[] = [];

  get clientCount(): number {
    return this.clients.size;
  }

  /** Register a client sink. Returns a remover. */
  addClient(send: (r: LogcatRecord) => void, canAccept: () => boolean): () => void {
    const c: Client = { send, canAccept, dropped: 0 };
    this.clients.add(c);
    for (const r of this.replay) send(r);
    return () => {
      this.clients.delete(c);
    };
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
        const n = c.dropped;
        c.dropped = 0;
        c.send({
          ts: Date.now(),
          pid: 0,
          tid: 0,
          level: 'W',
          tag: 'xenon',
          message: `${n} lines dropped (slow client)`,
          synthetic: true,
        });
      }
      c.send(record);
    }
  }
}
