import http from 'http';
import type { AddressInfo } from 'net';
import supertest from 'supertest';

/**
 * supertest's `request(app)`, served on 127.0.0.1. Import it in place of
 * supertest's default export; everything else about a request is unchanged.
 *
 * supertest listens on every address (`app.listen(0)`) and then connects to
 * 127.0.0.1. On macOS the kernel can give that listener a port another socket
 * still holds on 127.0.0.1, and a connection to 127.0.0.1 goes to that socket.
 * Another suite running at the same time then answers the request: a stray
 * 501 or a socket hang-up. Listening on 127.0.0.1 ourselves rules that out,
 * because the kernel never hands out a port already held there.
 * (loopbackServers() in loopbackServer.ts does the same for specs that manage
 * their servers themselves.)
 *
 * Binding 127.0.0.1 is asynchronous and supertest picks its URL in the
 * constructor, so the listen waits until the request is sent (`end()`, which
 * `await` and `.then()` call). A URL, or a server that is already listening,
 * is used as supertest would.
 */
const { Test } = supertest as unknown as {
  Test: new (app: unknown, method: string, path: string) => supertest.Test;
};

// One listen per server, however many requests are sent to it at once. The
// request that started it closes it, as supertest does.
const listens = new WeakMap<http.Server, Promise<number>>();

function listenOnLoopback(server: http.Server): { port: Promise<number>; owner: boolean } {
  const pending = listens.get(server);
  if (pending) return { port: pending, owner: false };
  const port = new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
  listens.set(server, port);
  server.once('close', () => listens.delete(server));
  return { port, owner: true };
}

class LoopbackTest extends (Test as any) {
  // `declare`d, never initialised: the base constructor sets them, through
  // serverAddress(), before a subclass initialiser would run.
  declare private loopbackApp?: http.Server;
  declare private loopbackPath?: string;

  serverAddress(app: http.Server, path: string): string {
    if (app.address()) return super.serverAddress(app, path);
    this.loopbackApp = app;
    this.loopbackPath = path;
    return `http://127.0.0.1${path}`; // replaced before the request is sent
  }

  end(fn?: (err: any, res: any) => void) {
    const app = this.loopbackApp;
    if (!app) return super.end(fn);
    const { port, owner } = listenOnLoopback(app);
    port.then(
      (p) => {
        if (owner) (this as any)._server = app;
        (this as any).url = `http://127.0.0.1:${p}${this.loopbackPath ?? ''}`;
        super.end(fn);
      },
      (err) => fn?.(err, undefined),
    );
    return this;
  }
}

const METHODS = http.METHODS.map((m) => m.toLowerCase());

function request(app: unknown): ReturnType<typeof supertest> {
  const obj: Record<string, (path: string) => supertest.Test> = {};
  for (const method of METHODS) {
    obj[method] = (path: string) => new (LoopbackTest as any)(app, method, path);
  }
  obj.del = obj.delete;
  return obj as unknown as ReturnType<typeof supertest>;
}

// supertest's types, under the same name, as `request.Test` and
// `request.Response` are with supertest's own default export. Only a
// namespace merged into the function gives a default export both.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace request {
  type Test = supertest.Test;
  type Response = supertest.Response;
}

export default request;
