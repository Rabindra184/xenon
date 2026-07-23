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

type Client = { send: (p: H264Packet) => void; started: boolean };

export class H264Multiplexer {
  private clients = new Set<Client>();
  private config?: H264Packet;
  private gop: H264Packet[] = []; // current GOP: [keyframe, ...deltas-since]

  setConfig(p: H264Packet): void {
    this.config = p;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Register a client sink. Returns a remover. */
  addClient(send: (p: H264Packet) => void): () => void {
    const c: Client = { send, started: false };
    this.clients.add(c);
    if (this.config) send(this.config);
    if (this.gop.length) {
      // Replay the current GOP so the decoder starts immediately.
      for (const pkt of this.gop) send(pkt);
      c.started = true;
    }
    return () => {
      this.clients.delete(c);
    };
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
