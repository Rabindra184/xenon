/**
 * One upstream H.264 stream fanned out to many WebSocket clients (mirrors the
 * MJPEG `UniversalMjpegProxy` role for the H.264 path).
 *
 * Join semantics: a new client immediately receives the latest `config`
 * (SPS/PPS), then the **current GOP** — the most recent keyframe plus every
 * delta since it — so its WebCodecs decoder can start rendering at once instead
 * of waiting for the next keyframe. (screenrecord emits keyframes infrequently,
 * so waiting would mean many seconds of blank preview on join.) If no keyframe
 * has been seen yet, the client waits for the first one. `config` packets are
 * always forwarded to every client so the decoder is configured before frames.
 */
export type H264PacketType = 'config' | 'key' | 'delta';

export interface H264Packet {
  type: H264PacketType;
  data: Buffer;
  ptsMs: number;
}

// Bounds the replay buffer for late joiners (~10s at 90fps). If a GOP grows
// past this (pathologically long keyframe interval), we stop buffering deltas;
// a late joiner then gets a brief artifact until the next keyframe.
const MAX_GOP_FRAMES = 900;

type Client = { send: (p: H264Packet) => void; started: boolean; end?: () => void };

export class H264Multiplexer {
  private clients = new Set<Client>();
  private config?: H264Packet;
  private gop: H264Packet[] = []; // current GOP: [keyframe, ...deltas-since]
  private emptyListener?: () => void;
  private closed = false;

  setConfig(p: H264Packet): void {
    this.config = p;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Called each time the last client leaves. */
  onEmpty(listener: () => void): void {
    this.emptyListener = listener;
  }

  /**
   * Register a client sink, and how to end it when the stream does (see
   * `close`). Returns a remover (safe to call twice).
   */
  addClient(send: (p: H264Packet) => void, end?: () => void): () => void {
    const c: Client = { send, started: false, end };
    if (this.closed) {
      // Joined a stream already stopped: end it now rather than starve it.
      end?.();
      return () => undefined;
    }
    this.clients.add(c);
    if (this.config) send(this.config);
    if (this.gop.length) {
      // Replay the current GOP so the decoder starts immediately.
      for (const pkt of this.gop) send(pkt);
      c.started = true;
    }
    return () => {
      if (this.clients.delete(c) && this.clients.size === 0) this.emptyListener?.();
    };
  }

  /**
   * The capture stopped: end every client (its socket closes, so its player
   * falls back to MJPEG instead of freezing on its last frame). Not an
   * `onEmpty`: nobody left, the stream did.
   */
  close(): void {
    this.closed = true;
    const ending = [...this.clients];
    this.clients.clear();
    for (const c of ending) {
      try {
        c.end?.();
      } catch {
        /* one client's end must not keep the others open */
      }
    }
  }

  /** Feed one upstream packet; fans out per the join semantics above. */
  push(p: H264Packet): void {
    if (p.type === 'config') {
      this.config = p;
      for (const c of this.clients) c.send(p); // config always forwarded
      return;
    }
    if (p.type === 'key') {
      this.gop = [p]; // a keyframe starts a fresh GOP
      for (const c of this.clients) {
        c.started = true; // this keyframe (re)starts any waiting client
        c.send(p);
      }
      return;
    }
    // delta
    if (this.gop.length && this.gop.length < MAX_GOP_FRAMES) this.gop.push(p);
    for (const c of this.clients) {
      if (c.started) c.send(p); // withhold deltas from a client with no keyframe yet
    }
  }
}
