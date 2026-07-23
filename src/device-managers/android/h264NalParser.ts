import { H264Packet } from './H264Multiplexer';

/**
 * Streaming Annex-B H.264 parser: turns the raw byte stream from
 * `adb screenrecord --output-format=h264` into access-unit {@link H264Packet}s.
 *
 * Adapted from the validated prototype (`scratchpad/scrcpy-proto`). NAL units
 * are delimited by start codes (`00 00 01` or `00 00 00 01`); a NAL is emitted
 * once the *next* start code bounds it, so the trailing (incomplete) NAL stays
 * buffered across `push()` calls. Non-VCL NALs (SPS 7 / PPS 8 / SEI 6 / AUD 9)
 * accumulate as `pending` and are prepended to the next keyframe; the first time
 * both SPS and PPS are seen a `config` packet (SPS+PPS) is emitted so late WS
 * joiners can configure their decoder.
 */
export class H264NalParser {
  private buf: Buffer = Buffer.alloc(0);
  private pending: Buffer[] = [];
  private sps?: Buffer;
  private pps?: Buffer;
  private configEmitted = false;
  private frameCount = 0;

  push(chunk: Buffer): H264Packet[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: H264Packet[] = [];
    let idx = this.findStart(this.buf, 0);
    if (idx < 0) return out;
    for (;;) {
      const next = this.findStart(this.buf, idx + this.scLen(this.buf, idx));
      if (next < 0) break;
      this.handleNal(this.buf.subarray(idx, next), out);
      idx = next;
    }
    this.buf = this.buf.subarray(idx); // keep the trailing (incomplete) NAL
    return out;
  }

  private findStart(b: Buffer, from: number): number {
    for (let i = from; i + 3 < b.length; i++) {
      if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) return i;
      if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 0 && b[i + 3] === 1) return i;
    }
    return -1;
  }

  private scLen(b: Buffer, i: number): number {
    return b[i + 2] === 1 ? 3 : 4;
  }

  private nalType(nal: Buffer): number {
    return nal[this.scLen(nal, 0)] & 0x1f;
  }

  private nextPtsMs(): number {
    // Monotonic timestamps at the device's ~90 Hz cap; the decoder only needs
    // them strictly increasing.
    return Math.round((this.frameCount++ * 1000) / 90);
  }

  private handleNal(nal: Buffer, out: H264Packet[]): void {
    const t = this.nalType(nal);
    if (t === 7) this.sps = nal;
    if (t === 8) this.pps = nal;
    if (!this.configEmitted && this.sps && this.pps) {
      this.configEmitted = true;
      out.push({ type: 'config', data: Buffer.concat([this.sps, this.pps]), ptsMs: 0 });
    }
    if (t === 6 || t === 7 || t === 8 || t === 9) {
      this.pending.push(nal);
      return;
    }
    if (t === 5 || t === 1) {
      const isKey = t === 5;
      const data = Buffer.concat(isKey ? [...this.pending, nal] : [nal]);
      this.pending = [];
      out.push({ type: isKey ? 'key' : 'delta', data, ptsMs: this.nextPtsMs() });
      return;
    }
    this.pending.push(nal);
  }
}
