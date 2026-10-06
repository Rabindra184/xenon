import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROBE_HOSTS, isPortInUse } from '../src/main/portProbe';

/** Listen on an OS-chosen port at one address; null when this machine can't use that address (no IPv6, say). */
async function occupy(host: string | undefined): Promise<{ port: number; close: () => Promise<void> } | null> {
  const server = net.createServer();
  const ok = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false));
    const done = () => resolve(true);
    if (host === undefined) server.listen(0, done);
    else server.listen(0, host, done);
  });
  if (!ok) return null;
  const { port } = server.address() as net.AddressInfo;
  return { port, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

/** A port nothing listens on: bound once to find a free number, then let go. */
async function freePort(): Promise<number> {
  const probe = await occupy('127.0.0.1');
  const { port } = probe!;
  await probe!.close();
  return port;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isPortInUse', () => {
  // Every kind of listener a real server or a stand-in might be. Connecting to
  // loopback reaches all of them except the ::1-only one, which is why ::1 is tried too.
  it.each([
    ['all IPv4 addresses (Appium, python http.server)', '0.0.0.0'],
    ['loopback only', '127.0.0.1'],
    ['all addresses, dual stack (Node listen())', undefined],
    ['all IPv6 addresses', '::'],
    ['IPv6 loopback', '::1']
  ] as [string, string | undefined][])('sees a server listening on %s', async (_label, host) => {
    const taken = await occupy(host);
    if (!taken) return; // this machine has no such address
    try {
      expect(await isPortInUse(taken.port)).toBe(true);
    } finally {
      await taken.close();
    }
  });

  it('says a port nobody listens on is free', async () => {
    expect(await isPortInUse(await freePort())).toBe(false);
  });

  it('says a port is free once its server has gone', async () => {
    const taken = await occupy('0.0.0.0');
    expect(taken).not.toBeNull();
    await taken!.close();
    expect(await isPortInUse(taken!.port)).toBe(false);
  });

  it('gives the same answer every time: looking does not take the port', async () => {
    const port = await freePort();
    expect(await isPortInUse(port)).toBe(false);
    expect(await isPortInUse(port)).toBe(false);
    // Nor does looking leave it unusable for the app that wants it next.
    const next = net.createServer();
    await new Promise<void>((resolve, reject) => next.once('error', reject).listen(port, '127.0.0.1', resolve));
    await new Promise((resolve) => next.close(resolve));
  });

  it('tries IPv4 loopback, then IPv6 loopback', () => {
    expect(PROBE_HOSTS).toEqual(['127.0.0.1', '::1']);
  });

  it('is in use when only the second address connects', async () => {
    const taken = await occupy('::1');
    if (!taken) return; // this machine has no IPv6 loopback
    try {
      // 127.0.0.1 refuses on this port; ::1 answers.
      expect(await isPortInUse(taken.port, ['127.0.0.1', '::1'])).toBe(true);
    } finally {
      await taken.close();
    }
  });

  it('counts a refused or unusable address as free, and does not throw', async () => {
    const port = await freePort();
    // Three ways an address can be unusable (not an address at all, an IPv6 range
    // this Mac has no route to, an IPv4 range nothing owns): each just means "free".
    await expect(isPortInUse(port, ['not-an-address'])).resolves.toBe(false);
    await expect(isPortInUse(port, ['2001:db8::1'])).resolves.toBe(false);
    await expect(isPortInUse(port, ['192.0.2.1'])).resolves.toBe(false);
  });

  it('still reports a server when another address cannot be reached', async () => {
    const taken = await occupy('127.0.0.1');
    try {
      expect(await isPortInUse(taken!.port, ['2001:db8::1', '127.0.0.1'])).toBe(true);
    } finally {
      await taken!.close();
    }
  });

  it('gives up on an address that never answers, in about a third of a second', async () => {
    const port = await freePort();
    const started = Date.now();
    expect(await isPortInUse(port, ['192.0.2.1'])).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('never listens: no firewall prompt, and nothing taken from a live server', async () => {
    const held = await occupy('0.0.0.0');
    const free = await freePort();
    // Spy only around the probe: the listeners above are the test's own.
    const createServer = vi.spyOn(net, 'createServer');
    const listen = vi.spyOn(net.Server.prototype, 'listen');
    try {
      expect(await isPortInUse(held!.port)).toBe(true);
      expect(await isPortInUse(free)).toBe(false);
      expect(createServer).not.toHaveBeenCalled();
      expect(listen).not.toHaveBeenCalled();
    } finally {
      await held!.close();
    }
  });
});

describe('isPortInUse called at the same time', () => {
  it('answers free for a free port even when calls start in the same tick', async () => {
    const port = await freePort();
    const answers = await Promise.all(Array.from({ length: 8 }, () => isPortInUse(port)));
    expect(answers).toEqual(Array(8).fill(false));
  });

  it('answers taken for every call when a server really holds the port', async () => {
    const taken = await occupy('0.0.0.0');
    try {
      const answers = await Promise.all([isPortInUse(taken!.port), isPortInUse(taken!.port), isPortInUse(taken!.port)]);
      expect(answers).toEqual([true, true, true]);
    } finally {
      await taken!.close();
    }
  });

  it('calls about different ports do not affect each other', async () => {
    const taken = await occupy('127.0.0.1');
    const free = await freePort();
    try {
      const [a, b, c, d] = await Promise.all([
        isPortInUse(taken!.port),
        isPortInUse(free),
        isPortInUse(taken!.port),
        isPortInUse(free)
      ]);
      expect([a, b, c, d]).toEqual([true, false, true, false]);
    } finally {
      await taken!.close();
    }
  });
});
