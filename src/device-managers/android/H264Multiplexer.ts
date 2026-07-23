/**
 * One upstream H.264 stream fanned out to many WebSocket clients (mirrors the
 * MJPEG `UniversalMjpegProxy` role for the H.264 path).
 *
 * Join semantics: a new client immediately receives the latest `config`
 * (SPS/PPS) if one exists, then receives packets **starting at the next
 * keyframe** — delta packets before that first keyframe are withheld so the
 * client's WebCodecs decoder never sees a mid-GOP frame it can't decode.
 * `config` packets are always forwarded to every client (even not-yet-started
 * ones) so the decoder can be configured before the keyframe arrives.
 */
export type H264PacketType = 'config' | 'key' | 'delta';

export interface H264Packet {
  type: H264PacketType;
  data: Buffer;
  ptsMs: number;
}

type Client = { send: (p: H264Packet) => void; started: boolean };

export class H264Multiplexer {
  private clients = new Set<Client>();
  private config?: H264Packet;

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
    for (const c of this.clients) {
      if (!c.started) {
        if (p.type === 'key') c.started = true;
        else continue; // withhold deltas until this client's first keyframe
      }
      c.send(p);
    }
  }
}
