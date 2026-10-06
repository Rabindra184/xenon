import net from 'node:net';

/**
 * Where a server can be listening, as far as Start is concerned. macOS lets a
 * socket bind 127.0.0.1:port while another app holds 0.0.0.0:port (Appium's own
 * default, and what `python3 -m http.server` and Node's listen() use), so
 * trying loopback alone calls a taken port free. Each address is tried on its
 * own: a wildcard bind answers for the wildcard listeners, a loopback bind for
 * the loopback ones.
 */
export const PROBE_HOSTS = ['127.0.0.1', '0.0.0.0', '::', '::1'] as const;

function bindable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      // Only a taken port counts. A host this Mac can't bind at all (no IPv6, say) says nothing about the port.
      .once('error', (err: NodeJS.ErrnoException) => resolve(err.code !== 'EADDRINUSE'))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, host);
  });
}

/** True when some app is already listening on the port, on any address a server could use. One at a time, so the probes can't collide with each other. */
export async function isPortInUse(port: number, hosts: readonly string[] = PROBE_HOSTS): Promise<boolean> {
  for (const host of hosts) {
    if (!(await bindable(port, host))) return true;
  }
  return false;
}
