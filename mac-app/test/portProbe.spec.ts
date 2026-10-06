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

  it('probes loopback, all IPv4 and all IPv6 addresses', () => {
    expect(PROBE_HOSTS).toEqual(expect.arrayContaining(['127.0.0.1', '0.0.0.0', '::']));
  });
});
