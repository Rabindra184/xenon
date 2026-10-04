import net from 'net';
import os from 'os';

/**
 * Reading a phone's global HTTP proxy (`settings get global http_proxy`), and
 * telling one Xenon's network capture left behind from one somebody set on
 * purpose.
 */

/** Android's ways of saying "no proxy": unset (`null`), empty, or `:0`. */
export function isUnsetProxy(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  return v === '' || v === 'null' || v === ':0';
}

/** `host:port`, or null for no proxy or anything else. */
export function parseProxySetting(
  value: string | null | undefined,
): { host: string; port: number } | null {
  if (isUnsetProxy(value)) return null;
  const v = (value as string).trim();
  const colon = v.lastIndexOf(':');
  if (colon <= 0) return null;
  const host = v.slice(0, colon);
  const portText = v.slice(colon + 1);
  if (!/^\d+$/.test(portText)) return null;
  const port = Number(portText);
  if (port < 1 || port > 65535) return null;
  return { host, port };
}

/** This machine's own IPv4 addresses, as a phone on its network reaches it. */
export function localIPv4Addresses(): string[] {
  const out: string[] = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address);
    }
  }
  return out;
}

/**
 * Whether a phone that uses `host` as its proxy reaches this machine: through
 * `adb reverse` (127.0.0.1, the phone itself), an emulator's alias for its
 * host (10.0.2.2), or this machine's own address (the interceptor's LAN
 * fallback). These are the only hosts the interceptor ever sets.
 */
export function pointsAtThisMachine(host: string, ownAddresses: string[]): boolean {
  const h = host.trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '10.0.2.2' || ownAddresses.includes(h);
}

/**
 * Whether something on this machine accepts a TCP connection on `port`.
 * Anything but a refusal counts as yes (a timeout too): only a port known to be
 * dead may have a proxy that points at it cleared.
 */
export function isPortListening(port: number, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (answer: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeoutMs, () => done(true));
    socket.once('connect', () => done(true));
    socket.once('error', (err: NodeJS.ErrnoException) => done(err.code !== 'ECONNREFUSED'));
  });
}

/**
 * Whether `value` is a proxy Xenon's network capture set and nobody serves any
 * more: it points at this machine, on one of this server's capture ports, and
 * nothing answers there. A phone with such a proxy has no network at all. A
 * proxy that points anywhere else, or at a port that answers (a capture that
 * is running, maybe another Xenon's on this machine), is never one.
 */
export async function isDeadCaptureProxy(
  value: string | null | undefined,
  captureRange: [number, number],
  probe: (port: number) => Promise<boolean> = isPortListening,
): Promise<boolean> {
  const proxy = parseProxySetting(value);
  if (!proxy) return false;
  if (!pointsAtThisMachine(proxy.host, localIPv4Addresses())) return false;
  if (proxy.port < captureRange[0] || proxy.port > captureRange[1]) return false;
  return !(await probe(proxy.port));
}
