import { expect } from 'chai';
import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  BURST_MS,
  LinkShaper,
  MAX_QUEUED_BYTES,
  ShapeLimits,
  UNLIMITED,
} from '../../../src/services/network/LinkShaper';

/**
 * ENH-20 part 2: the rate limit and delay a real phone's shaped traffic goes
 * through, per direction, shared by every connection of the phone.
 */
describe('LinkShaper', function () {
  this.timeout(30_000);

  const THREE_G: ShapeLimits = { downKbps: 2000, upKbps: 1000, latencyMs: 100 };
  const bytesPerSecond = (kbps: number) => kbps * 125;

  /** Sends `size` bytes in 16 KB chunks through `throttle`; resolves with each chunk's arrival time. */
  async function transfer(
    shaper: LinkShaper,
    direction: 'down' | 'up',
    size: number,
    chunk = 16 * 1024,
  ): Promise<{ ms: number; bytes: number; arrivals: number[] }> {
    const parts: Buffer[] = [];
    for (let sent = 0; sent < size; sent += chunk)
      parts.push(Buffer.alloc(Math.min(chunk, size - sent), 7));
    const started = Date.now();
    let bytes = 0;
    const arrivals: number[] = [];
    await pipeline(
      Readable.from(parts),
      shaper.throttle(direction),
      new Writable({
        write(data: Buffer, _enc, done) {
          bytes += data.length;
          arrivals.push(Date.now() - started);
          done();
        },
      }),
    );
    return { ms: Date.now() - started, bytes, arrivals };
  }

  it('limits each direction to its rate, within 10%', async () => {
    const shaper = new LinkShaper({ ...THREE_G, latencyMs: 0 });
    const size = 512 * 1024;
    const [down, up] = await Promise.all([
      transfer(shaper, 'down', size),
      transfer(shaper, 'up', size / 2),
    ]);
    const expectedDown = (size / bytesPerSecond(THREE_G.downKbps)) * 1000;
    const expectedUp = (size / 2 / bytesPerSecond(THREE_G.upKbps)) * 1000;
    expect(down.bytes).to.equal(size);
    expect(down.ms).to.be.within(expectedDown * 0.9, expectedDown * 1.1);
    expect(up.ms).to.be.within(expectedUp * 0.9, expectedUp * 1.1);
  });

  it('delays each chunk by half the latency', async () => {
    const shaper = new LinkShaper(THREE_G);
    const { arrivals } = await transfer(shaper, 'down', 10, 10);
    expect(arrivals[0]).to.be.within(50 - 20, 50 + 20);
  });

  it("shares a direction's rate between two throttles", async () => {
    const shaper = new LinkShaper({ ...THREE_G, latencyMs: 0 });
    const each = 256 * 1024;
    const [a, b] = await Promise.all([
      transfer(shaper, 'down', each),
      transfer(shaper, 'down', each),
    ]);
    const expected = ((2 * each) / bytesPerSecond(THREE_G.downKbps)) * 1000;
    expect(Math.max(a.ms, b.ms)).to.be.within(expected * 0.9, expected * 1.1);
    // Fair: neither finishes long before the other.
    expect(Math.abs(a.ms - b.ms)).to.be.below(expected * 0.2);
  });

  it('applies new limits to a transfer under way', async () => {
    // Edge's rates; no latency, so what is measured is the rate change alone.
    const shaper = new LinkShaper({ downKbps: 250, upKbps: 150, latencyMs: 0 });
    const going = transfer(shaper, 'down', 256 * 1024);
    await new Promise((resolve) => setTimeout(resolve, 500));
    shaper.setLimits(UNLIMITED);
    const { ms } = await going;
    expect(ms).to.be.below(500 + 100);
    expect(shaper.limits()).to.deep.equal(UNLIMITED);
  });

  it('passes bytes untimed when unlimited', async () => {
    const { ms, bytes } = await transfer(new LinkShaper(), 'down', 1024 * 1024);
    expect(bytes).to.equal(1024 * 1024);
    expect(ms).to.be.below(200);
  });

  it('keeps order within one throttle', async () => {
    const shaper = new LinkShaper(THREE_G);
    const seen: number[] = [];
    await pipeline(
      Readable.from(Array.from({ length: 100 }, (_, i) => Buffer.from([i]))),
      shaper.throttle('up'),
      new Writable({
        write(data: Buffer, _enc, done) {
          for (const b of data) seen.push(b);
          done();
        },
      }),
    );
    expect(seen).to.deep.equal(Array.from({ length: 100 }, (_, i) => i));
  });

  it('holds at most MAX_QUEUED_BYTES before pausing its writer', () => {
    const throttle = new LinkShaper({ downKbps: 250, upKbps: 150, latencyMs: 400 }).throttle(
      'down',
    );
    throttle.resume(); // nothing reads what comes out; only the input side is measured
    let written = 0;
    while (throttle.write(Buffer.alloc(16 * 1024))) {
      written += 16 * 1024;
      expect(written).to.be.at.most(MAX_QUEUED_BYTES);
    }
    expect(written + 16 * 1024).to.be.at.least(MAX_QUEUED_BYTES);
    throttle.destroy();
  });

  it('uses a burst of BURST_MS worth of bytes', () => {
    expect(BURST_MS).to.equal(50);
    expect(MAX_QUEUED_BYTES).to.equal(256 * 1024);
    expect(UNLIMITED).to.deep.equal({ downKbps: 0, upKbps: 0, latencyMs: 0 });
  });
});
