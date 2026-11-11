import net from 'net';
import { pipeline } from 'stream';
import { LinkShaper } from './LinkShaper';
import log from '../../logger';

/**
 * The relay a real phone's proxy points at (ENH-20 part 2). Every connection
 * the phone opens is piped to the relay's target through the phone's shaper:
 * `up` from the phone, `down` back to it. The bytes are never read, so HTTPS
 * stays end to end and the target can be any proxy: the session's capture
 * proxy, or the server's forward proxy.
 */
export interface ShapingRelayOptions {
  /** A port leased from the `proxy` range. */
  port: number;
  /** 127.0.0.1 when the phone comes through `adb reverse`; 0.0.0.0 on the LAN fallback. */
  bindHost: '127.0.0.1' | '0.0.0.0';
  shaper: LinkShaper;
  /** Where each new connection goes, read when it opens. */
  target: () => { host: string; port: number };
}

export class ShapingRelay {
  private server: net.Server | undefined;
  private readonly sockets = new Set<net.Socket>();
  private readonly logger = log.scope('ShapingRelay');

  constructor(private readonly opts: ShapingRelayOptions) {}

  port(): number {
    return this.opts.port;
  }

  /** The address it listens on. */
  address(): string | undefined {
    return (this.server?.address() as net.AddressInfo | null)?.address;
  }

  async start(): Promise<void> {
    // Half-open: a phone that shuts down its sending side once its request
    // is written (toybox nc, some HTTP/1.0 clients) still gets the answer.
    const server = net.createServer({ allowHalfOpen: true }, (phone) => this.relay(phone));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.port, this.opts.bindHost, () => resolve());
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private track(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
  }

  private relay(phone: net.Socket): void {
    this.track(phone);
    const { host, port } = this.opts.target();
    const upstream = net.connect({ port, host, allowHalfOpen: true });
    this.track(upstream);
    const up = this.opts.shaper.throttle('up');
    const down = this.opts.shaper.throttle('down');
    const all = [phone, upstream, up, down];
    let finished = 0;
    // Each direction ends on its own, passing its end (FIN) on: a half-close
    // carries through. An error, a socket closed outright, or both directions
    // done ends the whole connection, queued bytes included.
    const done = (err?: Error | null) => {
      if (err) {
        if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
          this.logger.debug(`The relay's target ${host}:${port} refused a connection`);
        }
        for (const s of all) s.destroy();
        return;
      }
      finished += 1;
      if (finished === 2) for (const s of all) s.destroy();
    };
    pipeline(phone, up, upstream, done);
    pipeline(upstream, down, phone, done);
  }
}
