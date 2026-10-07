import { describe, expect, it, vi } from 'vitest';
import { nextFreePort } from '../src/main/nextFreePort';

/** A probe that reports the given ports busy and every other port free, noting each port it was asked about. */
function probeBusy(busy: (port: number) => boolean) {
  const asked: number[] = [];
  const probe = vi.fn(async (port: number) => {
    asked.push(port);
    return busy(port);
  });
  return { probe, asked };
}

describe('nextFreePort', () => {
  it('gives the port itself when it is free', async () => {
    const { probe, asked } = probeBusy(() => false);
    expect(await nextFreePort(4724, probe)).toBe(4724);
    expect(asked).toEqual([4724]);
  });

  it('skips busy ports and gives the first free one', async () => {
    const { probe, asked } = probeBusy((p) => p === 4724 || p === 4725);
    expect(await nextFreePort(4724, probe)).toBe(4726);
    expect(asked).toEqual([4724, 4725, 4726]);
  });

  it('does not stop at a gap: it is the first free one, not the last', async () => {
    const { probe } = probeBusy((p) => p === 4724 || p === 4726);
    expect(await nextFreePort(4724, probe)).toBe(4725);
  });

  it('gives null when all 50 are busy, having asked about exactly 50', async () => {
    const { probe, asked } = probeBusy(() => true);
    expect(await nextFreePort(4724, probe)).toBeNull();
    expect(asked).toHaveLength(50);
    expect(asked[0]).toBe(4724);
    expect(asked[49]).toBe(4773);
  });

  it('can look further when asked to', async () => {
    const { probe, asked } = probeBusy((p) => p < 4730);
    expect(await nextFreePort(4724, probe, 3)).toBeNull();
    expect(asked).toEqual([4724, 4725, 4726]);
    expect(await nextFreePort(4724, probe, 10)).toBe(4730);
  });

  it('never goes above 65535', async () => {
    const { probe, asked } = probeBusy(() => true);
    expect(await nextFreePort(65530, probe)).toBeNull();
    expect(asked).toEqual([65530, 65531, 65532, 65533, 65534, 65535]);
  });

  it('can still find the last port', async () => {
    const { probe } = probeBusy((p) => p < 65535);
    expect(await nextFreePort(65530, probe)).toBe(65535);
  });

  it('has nothing to give from a port past the end', async () => {
    const { probe, asked } = probeBusy(() => false);
    expect(await nextFreePort(65536, probe)).toBeNull();
    expect(await nextFreePort(Number.NaN, probe)).toBeNull();
    expect(asked).toEqual([]);
  });

  it('starts at port 1 when given something below it', async () => {
    const { probe, asked } = probeBusy(() => false);
    expect(await nextFreePort(0, probe)).toBe(1);
    expect(asked).toEqual([1]);
  });

  it('asks one port at a time, in order', async () => {
    let inFlight = 0;
    let most = 0;
    const probe = async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return true;
    };
    await nextFreePort(4724, probe, 5);
    expect(most).toBe(1);
  });

  it('uses the real connect probe by default: a port nothing listens on is free', async () => {
    const net = await import('node:net');
    // Hold a port, find out the number, and let it go; it is free again.
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as import('node:net').AddressInfo;
    // While held, the default probe sees it busy, so the answer is another port.
    const whileHeld = await nextFreePort(port);
    expect(whileHeld).not.toBe(port);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await nextFreePort(port)).toBe(port);
  });
});
