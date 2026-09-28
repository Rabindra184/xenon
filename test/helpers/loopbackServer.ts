import type { Server } from 'http';

/**
 * Serve an Express app for supertest on an explicit 127.0.0.1 port.
 *
 * `request(app)` listens on the wildcard address and then connects to
 * 127.0.0.1. On macOS another process may hold a more specific 127.0.0.1 bind
 * on the same ephemeral port, and the connection lands there instead: a spec
 * then sees a stray status or a socket hang-up whenever another suite runs at
 * the same time. Binding 127.0.0.1 ourselves rules that out.
 *
 * Call `closeAll()` from an afterEach inside the describe.
 */
export function loopbackServers() {
  const servers: Server[] = [];
  return {
    async serve(app: { listen: (...args: any[]) => Server }): Promise<Server> {
      const server = await new Promise<Server>((resolve, reject) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
        s.on('error', reject);
      });
      servers.push(server);
      return server;
    },
    async closeAll(): Promise<void> {
      const closing = servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections?.();
            server.close(() => resolve());
          }),
      );
      await Promise.all(closing);
    },
  };
}
