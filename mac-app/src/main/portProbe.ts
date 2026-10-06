import net from 'node:net';

/**
 * Where a server can be listening, as far as Start is concerned. macOS lets a
 * socket bind 127.0.0.1:port while another app holds 0.0.0.0:port (Appium's own
 * default, and what `python3 -m http.server` and Node's listen() use), so
 * trying loopback alone calls a taken port free. Each address is tried on its
 * own: a wildcard bind answers for the wildcard listeners, a loopback bind for
 * the loopback ones.
 *
 * Wildcards go first. A bind to 127.0.0.1 would, while it lasts, take new
 * connections away from a live server holding 0.0.0.0 on the same port, and
 * these probes run on window focus against this Mac's own server. A live
 * wildcard server is found by the wildcard bind, which stops the probe before
 * loopback is touched.
 */
export const PROBE_HOSTS = ['0.0.0.0', '::', '127.0.0.1', '::1'] as const;

/** Whether the address can be bound on this port: false only when something else already holds it. */
export type TryBind = (port: number, host: string) => Promise<boolean>;

const bindable: TryBind = (port, host) =>
  new Promise((resolve) => {
    const tester = net
      .createServer()
      // Only a taken port counts. A host this Mac can't bind at all (no IPv6, say) says nothing about the port.
      .once('error', (err: NodeJS.ErrnoException) => resolve(err.code !== 'EADDRINUSE'))
      // Resolve once the probe has let go, so the next one finds the port as it was.
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, host);
  });

// Probes bind the very port they are asking about, so two running at once see each
// other as a live server. Every call waits for the one before it.
let queue: Promise<unknown> = Promise.resolve();

/** True when some app is already listening on the port, on any address a server could use. */
export function isPortInUse(
  port: number,
  hosts: readonly string[] = PROBE_HOSTS,
  tryBind: TryBind = bindable
): Promise<boolean> {
  const run = queue.then(async () => {
    for (const host of hosts) {
      if (!(await tryBind(port, host))) return true;
    }
    return false;
  });
  // A failed call must not wedge the calls behind it.
  queue = run.catch(() => undefined);
  return run;
}
