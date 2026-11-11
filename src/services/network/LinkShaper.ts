import { Transform, TransformCallback } from 'stream';

/**
 * The rate limit and delay a real phone's shaped traffic goes through
 * (ENH-20 part 2). One shaper per phone, shared by all its connections, so
 * parallel transfers share the profile's bandwidth as on a real link.
 *
 * Each direction has a token bucket (bytes per second from the profile's
 * kbps, a burst of BURST_MS worth), served first come first served, and
 * delays each chunk by half the profile's latency after it has its tokens.
 * The delay is a propagation delay: it doesn't hold the next chunk's token
 * wait, so it adds latency without cutting throughput.
 */

/** A profile's figures. 0 kbps is no limit. */
export interface ShapeLimits {
  downKbps: number;
  upKbps: number;
  latencyMs: number;
}

export const UNLIMITED: ShapeLimits = { downKbps: 0, upKbps: 0, latencyMs: 0 };

/** How much a bucket holds: this many milliseconds of its rate. */
export const BURST_MS = 50;

/** Bytes a connection may have waiting per direction before its writer is paused. */
export const MAX_QUEUED_BYTES = 256 * 1024;

/** `down` is toward the phone, `up` from it. */
export type Direction = 'down' | 'up';

const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

/** A token bucket whose waiters are served in arrival order. */
class Bucket {
  private rate = 0; // bytes per ms; 0: no limit
  private capacity = 0;
  private tokens = 0;
  private refilledAt = nowMs();
  private waiters: Array<{ bytes: number; ready: () => void }> = [];
  private timer: NodeJS.Timeout | undefined;

  setKbps(kbps: number): void {
    this.refill();
    this.rate = kbps > 0 ? (kbps * 125) / 1000 : 0;
    this.capacity = this.rate * BURST_MS;
    this.tokens = Math.min(this.tokens, this.capacity);
    this.serve();
  }

  /** The most one wait may ask for. */
  maxBytes(): number {
    return this.rate > 0 ? Math.max(1, Math.floor(this.capacity)) : Infinity;
  }

  take(bytes: number): Promise<void> {
    if (this.rate === 0 && this.waiters.length === 0) return Promise.resolve();
    return new Promise((ready) => {
      this.waiters.push({ bytes, ready });
      this.serve();
    });
  }

  private refill(): void {
    const now = nowMs();
    if (this.rate > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + (now - this.refilledAt) * this.rate);
    }
    this.refilledAt = now;
  }

  private serve(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.refill();
    while (this.waiters.length > 0) {
      const head = this.waiters[0];
      if (this.rate > 0) {
        const needed = Math.min(head.bytes, this.capacity);
        if (this.tokens < needed) {
          const waitMs = (needed - this.tokens) / this.rate;
          this.timer = setTimeout(() => this.serve(), Math.max(1, Math.ceil(waitMs)));
          this.timer.unref();
          return;
        }
        this.tokens -= needed;
      }
      this.waiters.shift();
      head.ready();
    }
  }
}

export class LinkShaper {
  private current: ShapeLimits = UNLIMITED;
  private readonly buckets: Record<Direction, Bucket> = { down: new Bucket(), up: new Bucket() };

  constructor(limits: ShapeLimits = UNLIMITED) {
    this.setLimits(limits);
  }

  /** New figures, for every connection, from their next chunk on. */
  setLimits(limits: ShapeLimits): void {
    this.current = { ...limits };
    this.buckets.down.setKbps(limits.downKbps);
    this.buckets.up.setKbps(limits.upKbps);
  }

  limits(): ShapeLimits {
    return { ...this.current };
  }

  /** One connection's bytes in one direction, shaped. */
  throttle(direction: Direction): Transform {
    const bucket = this.buckets[direction];
    const shaper = this;
    let releaseAt = 0; // pushes leave in order: never before the one before
    let pending = 0;
    let flushed: (() => void) | undefined;
    const released = () => {
      pending -= 1;
      if (pending === 0 && flushed) flushed();
    };

    return new Transform({
      highWaterMark: MAX_QUEUED_BYTES,
      transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
        void (async () => {
          for (let at = 0; at < chunk.length; ) {
            const size = Math.min(chunk.length - at, bucket.maxBytes());
            await bucket.take(size);
            const piece = chunk.subarray(at, at + size);
            at += size;
            const delay = shaper.current.latencyMs / 2;
            releaseAt = Math.max(releaseAt, nowMs() + delay);
            const wait = releaseAt - nowMs();
            if (wait <= 0) {
              this.push(piece);
            } else {
              pending += 1;
              setTimeout(() => {
                this.push(piece);
                released();
              }, wait).unref();
            }
          }
          done();
        })().catch(done);
      },
      flush(done: TransformCallback) {
        if (pending === 0) return done();
        flushed = () => done();
      },
    });
  }
}
