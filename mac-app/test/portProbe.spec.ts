import net from 'node:net';
import { describe, expect, it } from 'vitest';
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

describe('isPortInUse', () => {
  // Every kind of listener a real server or a stand-in might be: the
  // loopback-only one is the only kind a 127.0.0.1 probe alone would see.
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

  it('says a port is free once its server has gone', async () => {
    const taken = await occupy('0.0.0.0');
    expect(taken).not.toBeNull();
    await taken!.close();
    expect(await isPortInUse(taken!.port)).toBe(false);
  });

  it('does not take the port for itself while probing: a second look gives the same answer', async () => {
    const probe = await occupy('127.0.0.1');
    const port = probe!.port;
    await probe!.close();
    expect(await isPortInUse(port)).toBe(false);
    expect(await isPortInUse(port)).toBe(false);
  });

  it('ignores an address this Mac cannot bind, instead of calling the port taken', async () => {
    const probe = await occupy('127.0.0.1');
    const port = probe!.port;
    await probe!.close();
    // 192.0.2.0/24 is reserved for documentation: never assigned to a local interface.
    expect(await isPortInUse(port, ['192.0.2.1'])).toBe(false);
  });

  it('probes the wildcard addresses before the loopback ones', () => {
    // A bind to 127.0.0.1 would briefly take new connections away from a live
    // server holding 0.0.0.0 on the same port. Wildcards first means that
    // server is found, and the probe stops, before loopback is ever touched.
    expect(PROBE_HOSTS).toEqual(['0.0.0.0', '::', '127.0.0.1', '::1']);
  });

  it('stops at the first address that is taken', async () => {
    const tried: string[] = [];
    const bind = async (_port: number, host: string) => {
      tried.push(host);
      return host !== '::'; // something holds the IPv6 wildcard
    };
    expect(await isPortInUse(4797, PROBE_HOSTS, bind)).toBe(true);
    expect(tried).toEqual(['0.0.0.0', '::']);
  });

  it('only a taken port counts: every address bindable means free, and each is tried', async () => {
    const tried: string[] = [];
    const bind = async (_port: number, host: string) => {
      tried.push(host);
      return true;
    };
    expect(await isPortInUse(4797, PROBE_HOSTS, bind)).toBe(false);
    expect(tried).toEqual([...PROBE_HOSTS]);
  });
});

describe('isPortInUse called at the same time', () => {
  async function freePort(): Promise<number> {
    const probe = await occupy('127.0.0.1');
    const { port } = probe!;
    await probe!.close();
    return port;
  }

  it('answers free for a free port even when two calls start in the same tick', async () => {
    const port = await freePort();
    // Unserialized, the two probes bind the same address at once and each sees the other as a live server.
    const [a, b] = await Promise.all([isPortInUse(port), isPortInUse(port)]);
    expect([a, b]).toEqual([false, false]);
  });

  it('keeps answering free under a burst of calls', async () => {
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

  it('one call failing does not stop the next from running', async () => {
    const boom = async () => {
      throw new Error('bind blew up');
    };
    await expect(isPortInUse(4797, PROBE_HOSTS, boom)).rejects.toThrow('bind blew up');
    const port = await freePort();
    expect(await isPortInUse(port)).toBe(false);
  });
});
