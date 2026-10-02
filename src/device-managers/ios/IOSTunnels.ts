/**
 * One go-ios tunnel per iOS 17+ phone, each on its own leased pair of ports.
 *
 * On iOS 17 and later, the go-ios commands Xenon runs against a phone's
 * services (`runwda`, `ostrace`, `syslog`, `screenshot`) reach it through a
 * tunnel, which they find through that tunnel's info API. Through 2.7 every
 * tunnel took go-ios's default ports (60105 for the API, 60106 for the
 * traffic), so a second iPhone's stream killed the first one's tunnel.
 *
 * Each phone now gets `tunnel start --udid <phone> --tunnel-info-port <P>`,
 * an isolated per-device agent: P from the `tunnel` port range, and P + 1,
 * which go-ios derives for the phone's traffic. A command finds its phone's
 * tunnel through GO_IOS_AGENT_PORT, set by {@link IOSTunnels.envFor}.
 *
 * go-ios does not end an agent when its phone is unplugged. The agent only
 * drops the phone's tunnel, and on the replug starts a new one on its next
 * traffic port, P + 2, then P + 3: the next phone's leased pair. So a tunnel
 * whose phone went away, or whose traffic port moved, is stopped
 * ({@link IOSTunnels.checkTunnels}, every few seconds), and the phone's next
 * stream start makes a new one on a fresh pair.
 *
 * This is mechanism only. When a tunnel may be stopped (never under a live
 * Appium session) is IOSStreamService's decision.
 */
import { Container, Service } from 'typedi';
import { spawn, exec, type ChildProcess } from 'child_process';
import http from 'http';
import path from 'path';
import { promisify } from 'util';
import log from '../../logger';
import { cachePath } from '../../helpers';
import { PortAllocator } from '../../services/PortAllocator';
import { ProcessRegistry } from '../../services/ProcessRegistry';
import { ResourceIsolationService } from '../../services/ResourceIsolationService';
import { classifyTunnelStderr } from './iosStreamDiagnostics';
import { killProcessGroup, tunnelSpawnOptions } from './tunnelProcess';

const execPromise = promisify(exec);

/** How long a new tunnel has to answer for its phone before the start goes on without it. */
export const TUNNEL_READY_TIMEOUT_MS = 20_000;
export const TUNNEL_READY_POLL_MS = 500;
/**
 * A tunnel's port lease: the same as the stream's own ports
 * (IOSStreamService's STREAM_PORT_TTL_MS). The stream watchdog refreshes both
 * every hour, the tunnel's through {@link IOSTunnels.touch}.
 */
export const TUNNEL_LEASE_TTL_MS = 90 * 60 * 1000;
/** How often running tunnels are checked for a phone that went away. */
export const TUNNEL_CHECK_MS = 5_000;

/**
 * What a tunnel's agent says about its phone: `up` (with the traffic port it
 * listens on, when the answer names one), `gone` (404: no tunnel for the
 * phone), or `unknown` (no answer, or one that says neither).
 */
export type TunnelState =
  | { state: 'up'; userspacePort?: number }
  | { state: 'gone' }
  | { state: 'unknown' };

/** The iOS version `ios info` reports, as a number: 17.2 for "17.2.1" or "iOS 17.2", 0 for none. */
export function iosVersionOf(info: {
  ProductVersion?: unknown;
  HumanReadableProductVersionString?: unknown;
}): number {
  const versionStr = String(info.ProductVersion || info.HumanReadableProductVersionString || '0');
  const match = versionStr.match(/(\d+\.?\d*)/);
  return match ? parseFloat(match[0]) : 0;
}

/** The longest go-ios reason kept for an error message. */
const REASON_MAX = 200;

/**
 * The last error or warning in a chunk of go-ios's stderr, for an error
 * message. go-ios logs JSON lines: an ERROR or WARN line gives its `msg` and
 * `error`, an INFO line gives nothing, and a line that isn't JSON (a panic)
 * is kept as it is.
 */
export function goIosReason(text: string): string | undefined {
  let reason: string | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      entry = undefined;
    }
    if (entry && typeof entry === 'object') {
      const level = String(entry.level ?? '').toUpperCase();
      if ((level === 'ERROR' || level === 'WARN') && entry.msg) {
        reason = entry.error ? `${entry.msg}: ${entry.error}` : String(entry.msg);
      }
    } else {
      reason = line;
    }
  }
  return reason?.slice(0, REASON_MAX);
}

interface Tunnel {
  port: number;
  process: ChildProcess;
  /** Its agent has answered for the phone on P + 1 at least once. */
  ready: boolean;
  /** go-ios's last error or warning, for the error when the tunnel fails. */
  reason?: string;
}

/** An answer that puts the phone's traffic anywhere but its leased P + 1. */
function moved(info: TunnelState, port: number): info is { state: 'up'; userspacePort: number } {
  return info.state === 'up' && info.userspacePort !== undefined && info.userspacePort !== port + 1;
}

@Service()
export class IOSTunnels {
  private log = log.scope('IOSTunnels');
  private tunnels = new Map<string, Tunnel>();
  private watcher?: ReturnType<typeof setInterval>;
  private checking = false;
  public goIOSPath = path.join(cachePath('goIOS'), 'ios');

  /**
   * The phone's tunnel-info port, starting its tunnel if it has none. Null
   * for a phone below iOS 17, or whose version can't be read: it needs no
   * tunnel. Throws when no pair of ports is left, or when the tunnel exits
   * before it is ready.
   */
  async ensure(udid: string): Promise<number | null> {
    const running = this.portFor(udid);
    if (running !== undefined) return running;

    let version: number;
    try {
      version = await this.iosVersion(udid);
    } catch (e: any) {
      this.log.warn(
        `[${udid}] Could not read the iOS version, so no go-ios tunnel: ${e?.message ?? e}`,
      );
      return null;
    }
    if (version < 17) return null;

    const port = await this.allocator().acquirePair('tunnel', udid, {
      ttlMs: TUNNEL_LEASE_TTL_MS,
    });
    let proc: ChildProcess;
    try {
      proc = this.spawnTunnel(udid, [
        'tunnel',
        'start',
        '--udid',
        udid,
        '--userspace',
        '--tunnel-info-port',
        String(port),
      ]);
    } catch (e) {
      await this.releasePair(port, udid);
      throw e;
    }
    const tunnel: Tunnel = { port, process: proc, ready: false };
    this.tunnels.set(udid, tunnel);
    this.watch();
    // A tunnel whose process ends (go-ios crashed, or something killed it)
    // gives its ports back, and the phone's next start gets a new one. An
    // unplug doesn't end it: see checkTunnels.
    const ended = () => {
      if (this.tunnels.get(udid) !== tunnel) return;
      this.tunnels.delete(udid);
      this.unwatchIfIdle();
      void this.releasePair(port, udid);
    };
    proc.once('exit', ended);
    proc.once('error', (err: Error) => {
      this.log.warn(`[${udid}] go-ios tunnel failed: ${err.message}`);
      ended();
    });
    this.logOutput(udid, tunnel);

    this.log.info(
      `[${udid}] iOS ${version}: starting a go-ios tunnel on ${port} (traffic on ${port + 1})`,
    );
    const polls = TUNNEL_READY_TIMEOUT_MS / TUNNEL_READY_POLL_MS;
    for (let poll = 0; poll <= polls; poll++) {
      if (poll > 0) await this.sleep(TUNNEL_READY_POLL_MS);
      if (this.tunnels.get(udid) !== tunnel) {
        throw new Error(
          `The go-ios tunnel for ${udid} exited before it was ready (exit code ${proc.exitCode})` +
            (tunnel.reason ? `: ${tunnel.reason}` : ''),
        );
      }
      const info = await this.tunnelInfo(port, udid);
      if (moved(info, port)) {
        // A first attempt failed and go-ios retried on its next port, which
        // may be another phone's.
        await this.stop(udid);
        throw new Error(
          `The go-ios tunnel for ${udid} came up on port ${info.userspacePort}, not its leased ${port + 1}, so it was stopped`,
        );
      }
      if (info.state === 'up') {
        tunnel.ready = true;
        this.log.info(`[${udid}] go-ios tunnel ready on ${port}`);
        return port;
      }
    }
    this.log.warn(
      `[${udid}] go-ios tunnel on ${port} not ready after ${TUNNEL_READY_TIMEOUT_MS / 1000}s, proceeding anyway`,
    );
    return port;
  }

  /** The phone's tunnel-info port, while its tunnel runs. */
  portFor(udid: string): number | undefined {
    const tunnel = this.tunnels.get(udid);
    return tunnel && tunnel.process.exitCode === null ? tunnel.port : undefined;
  }

  /**
   * The environment for a go-ios command about this phone: today's, plus
   * GO_IOS_AGENT_PORT while the phone has a tunnel, so the command finds that
   * tunnel and not go-ios's default 60105.
   */
  envFor(udid: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' };
    const port = this.portFor(udid);
    if (port !== undefined) env.GO_IOS_AGENT_PORT = String(port);
    return env;
  }

  /** Stop the phone's tunnel and give its ports back. Other phones' tunnels are untouched. */
  async stop(udid: string): Promise<void> {
    const tunnel = this.tunnels.get(udid);
    if (!tunnel) return;
    this.tunnels.delete(udid);
    this.unwatchIfIdle();
    this.killGroup(tunnel.process.pid);
    await this.releasePair(tunnel.port, udid);
  }

  /**
   * Stop each tunnel whose phone has gone, and give its ports back. go-ios
   * keeps a per-device agent running when its phone is unplugged and, on the
   * replug, starts the tunnel on its next traffic port: the next phone's
   * pair. So a tunnel that had its phone and now answers 404, or that answers
   * on a traffic port other than P + 1, is stopped. Either way the phone's
   * stream has already lost it, and its next start makes a new one.
   *
   * An agent that doesn't answer is left alone: a busy agent isn't a gone
   * phone, and one whose process died is handled by its exit.
   */
  async checkTunnels(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      for (const [udid, tunnel] of [...this.tunnels]) {
        const info = await this.tunnelInfo(tunnel.port, udid);
        if (this.tunnels.get(udid) !== tunnel) continue;
        if (moved(info, tunnel.port)) {
          this.log.warn(
            `[${udid}] go-ios moved the phone's tunnel from port ${tunnel.port + 1} to ${info.userspacePort} (it reconnected); stopping it`,
          );
        } else if (info.state === 'gone' && tunnel.ready) {
          this.log.warn(
            `[${udid}] go-ios tunnel on ${tunnel.port} lost its phone (unplugged?); stopping it and freeing its ports`,
          );
        } else {
          if (info.state === 'up') tunnel.ready = true;
          continue;
        }
        await this.stop(udid);
      }
    } finally {
      this.checking = false;
    }
  }

  private watch(): void {
    if (this.watcher) return;
    this.watcher = setInterval(() => void this.checkTunnels(), TUNNEL_CHECK_MS);
    this.watcher.unref?.();
  }

  private unwatchIfIdle(): void {
    if (this.tunnels.size > 0 || !this.watcher) return;
    clearInterval(this.watcher);
    this.watcher = undefined;
  }

  /** Keep the phone's tunnel ports leased. The stream watchdog calls this hourly. */
  async touch(udid: string): Promise<void> {
    const tunnel = this.tunnels.get(udid);
    if (!tunnel) return;
    const allocator = this.allocator();
    await allocator.touch(tunnel.port, TUNNEL_LEASE_TTL_MS);
    await allocator.touch(tunnel.port + 1, TUNNEL_LEASE_TTL_MS);
  }

  private async releasePair(port: number, udid: string): Promise<void> {
    try {
      const allocator = this.allocator();
      await allocator.release(port, udid);
      await allocator.release(port + 1, udid);
    } catch (e: any) {
      this.log.warn(
        `[${udid}] Could not release tunnel ports ${port}-${port + 1}: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * go-ios's output, at debug. Its repeated warning about a connected
   * pre-iOS 17 phone (which needs no tunnel) is logged once per phone. Its
   * last error or warning is kept, for the error if the tunnel fails.
   */
  private logOutput(udid: string, tunnel: Tunnel): void {
    const proc = tunnel.process;
    proc.stdout?.on('data', (data) => this.log.debug(`Tunnel [${udid}]: ${data}`));
    const loggedUnsupported = new Set<string>();
    proc.stderr?.on('data', (data) => {
      const text = String(data);
      const { unsupported, udid: targetUdid } = classifyTunnelStderr(text);
      if (unsupported) {
        const key = targetUdid ?? 'unknown';
        if (!loggedUnsupported.has(key)) {
          loggedUnsupported.add(key);
          this.log.debug(
            `Tunnel [${udid}]: device ${key} is pre-iOS 17 and needs no tunnel; suppressing repeated go-ios warnings`,
          );
        }
        return;
      }
      tunnel.reason = goIosReason(text) ?? tunnel.reason;
      this.log.debug(`Tunnel Err [${udid}]: ${text}`);
    });
  }

  // ---------------------------------------------------------------------
  // Seams. Overridden by tests; the defaults are the real thing.
  // ---------------------------------------------------------------------

  protected async iosVersion(udid: string): Promise<number> {
    const { stdout } = await execPromise(`"${this.goIOSPath}" info --udid ${udid}`, {
      env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
    });
    return iosVersionOf(JSON.parse(stdout));
  }

  /**
   * Detached, so the tunnel leads its own process group and its self-forking
   * agent children die with it (see ./tunnelProcess).
   */
  protected spawnTunnel(udid: string, args: string[]): ChildProcess {
    const wrapped = Container.get(ResourceIsolationService).wrapSpawn(
      this.goIOSPath,
      args,
      'Performance', // a tunnel the phone's stream depends on
    );
    const proc = spawn(
      wrapped.command,
      wrapped.args,
      tunnelSpawnOptions({ ...process.env, ENABLE_GO_IOS_AGENT: 'yes' }),
    );
    Container.get(ProcessRegistry).track({ kind: 'other', udid, process: proc });
    return proc;
  }

  /**
   * What the tunnel's agent on `port` says about the phone. go-ios answers
   * `GET /tunnel/<udid>` with 404 until it has the phone's tunnel, then 200
   * with the tunnel, `userspaceTunPort` included.
   */
  protected tunnelInfo(port: number, udid: string): Promise<TunnelState> {
    return new Promise((resolve) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: `/tunnel/${encodeURIComponent(udid)}`,
          timeout: 1000,
          agent: false,
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            resolve(res.statusCode === 404 ? { state: 'gone' } : { state: 'unknown' });
            return;
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (body += chunk));
          res.on('end', () => {
            let userspacePort: number | undefined;
            try {
              const value = JSON.parse(body)?.userspaceTunPort;
              if (typeof value === 'number') userspacePort = value;
            } catch {
              // A 200 without JSON still says the tunnel is up.
            }
            resolve({ state: 'up', userspacePort });
          });
          res.on('error', () => resolve({ state: 'unknown' }));
        },
      );
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve({ state: 'unknown' }));
    });
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected killGroup(pid: number | undefined): void {
    killProcessGroup(pid);
  }

  protected allocator(): PortAllocator {
    return Container.get(PortAllocator);
  }
}
