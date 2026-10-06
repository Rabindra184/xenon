import net from 'node:net';

/**
 * The two loopback addresses a connection to "localhost" can land on. A server
 * bound to a wildcard (0.0.0.0, or :: dual stack: Appium's default, Node's
 * listen(), python3 -m http.server) answers on loopback too, and a server bound
 * to one loopback address answers on that one, so these two cover every
 * listener a server could be.
 */
export const PROBE_HOSTS = ['127.0.0.1', '::1'] as const;

/** Loopback answers in well under this; an address that stays silent is not a listening server. */
const CONNECT_TIMEOUT_MS = 300;

/** Whether something accepts a connection at the address. Refused, unusable or silent all mean no. */
function accepts(port: number, host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    let settled = false;
    const finish = (answer: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    // ECONNREFUSED is the port being free. EADDRNOTAVAIL and EAFNOSUPPORT are a
    // Mac with no IPv6; anything else is no better evidence of a server. None throw.
    socket.once('error', () => finish(false));
  });
}

/**
 * True when some app is already listening on the port.
 *
 * It asks by connecting, never by binding. Binding the port to test it makes
 * macOS show its "accept incoming connections" firewall prompt for this app,
 * and a bind to 127.0.0.1 takes new connections away from a live server that
 * holds 0.0.0.0 on the same port, while it lasts. These checks run on window
 * focus, so both would happen all the time. A connection attempt does neither,
 * and calls can overlap freely because none of them holds anything.
 */
export async function isPortInUse(port: number, hosts: readonly string[] = PROBE_HOSTS): Promise<boolean> {
  const answers = await Promise.all(hosts.map((host) => accepts(port, host, CONNECT_TIMEOUT_MS)));
  return answers.some(Boolean);
}
