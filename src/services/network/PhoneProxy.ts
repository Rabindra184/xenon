import * as os from 'os';
import { Container, Service } from 'typedi';
import log from '../../logger';
import { IDevice } from '../../interfaces/IDevice';
import { AndroidProxyAdapter } from '../interceptor/AndroidProxyAdapter';
import { PortAllocator } from '../PortAllocator';
import { adbForPhone } from './adbForPhone';
import { PhoneNetworkLedger } from './PhoneNetworkLedger';
import { withPhoneNetworkLock } from './phoneNetworkLock';
import { isDeadCaptureProxy, isUnsetProxy } from './xenonProxy';

/** How a phone reaches a port on this machine. */
export interface ProxyRoute {
  /** The host the phone's proxy setting names. */
  deviceHost: string;
  /** An `adb reverse` was set up for the port, and must be removed. */
  reverse: boolean;
  transport: 'emulator' | 'adb-reverse' | 'lan-fallback';
}

interface PointedSession {
  udid: string;
  previous: string | null;
  set: string;
  reversePorts: number[];
}

/**
 * The one owner of a phone's global HTTP proxy for a session (ENH-20 part
 * 2). Network capture and traffic shaping both point it here, so neither
 * overwrites the other's change: the phone's own setting is read and written
 * down before the first change, later changes only move `set`, and the end
 * of the session puts the phone's own back once, with every `adb reverse`
 * removed. A crash leaves the record in the ledger, which a restart undoes
 * (PhoneNetworkRestore).
 */
@Service()
export class PhoneProxy {
  private readonly logger = log.scope('PhoneProxy');
  private readonly sessions = new Map<string, PointedSession>();
  private adapter: AndroidProxyAdapter | undefined;

  private proxies(): AndroidProxyAdapter {
    return (this.adapter ??= new AndroidProxyAdapter(adbForPhone));
  }

  /** Whether this owner has pointed the phone's proxy for the session. */
  owns(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * How `device` will reach `port` on this machine. An emulator has
   * `10.0.2.2`, its alias for this machine. A real phone gets an `adb
   * reverse` of the port over its adb connection, USB or wireless, and
   * reaches it at its own 127.0.0.1. If that fails, this machine's LAN
   * address, which works only when the phone shares the LAN.
   */
  async route(device: IDevice, port: number): Promise<ProxyRoute> {
    if (device.deviceType === 'emulator') {
      return { deviceHost: '10.0.2.2', reverse: false, transport: 'emulator' };
    }
    try {
      await this.proxies().addReverse(device.udid, port, port);
      return { deviceHost: '127.0.0.1', reverse: true, transport: 'adb-reverse' };
    } catch (err: any) {
      const lan = firstNonLoopbackIPv4() ?? '127.0.0.1';
      this.logger.warn(
        `adb reverse failed for ${device.udid} (${err.message}); falling back to host LAN IP ${lan}. ` +
          'The phone reaches Xenon only if it can reach this address.',
      );
      return { deviceHost: lan, reverse: false, transport: 'lan-fallback' };
    }
  }

  /**
   * Undoes `route` for a port the phone's proxy was never pointed at (its
   * user failed to start): removes the `adb reverse`, if there is one.
   */
  async unroute(device: IDevice, port: number, route: ProxyRoute): Promise<void> {
    if (!route.reverse) return;
    try {
      await this.proxies().removeReverse(device.udid, port);
    } catch (err: any) {
      this.logger.warn(
        `adb reverse --remove failed for ${device.udid}:${port}: ${err?.message ?? err}`,
      );
    }
  }

  /**
   * Points the phone's proxy at `port` by `route`. The first call for the
   * session reads the phone's own setting and writes it down, then sets the
   * proxy; a later one only moves the setting. A proxy an earlier run left
   * pointing at a dead capture port isn't the phone's own: it counts as none.
   */
  async pointAt(
    sessionId: string,
    device: IDevice,
    port: number,
    route: ProxyRoute,
    opts: LockOptions = {},
  ): Promise<void> {
    const udid = device.udid;
    const setting = `${route.deviceHost}:${port}`;
    await underLock(udid, opts, async () => {
      let session = this.sessions.get(sessionId);
      // What a later call found, so a change that fails can be taken back.
      const prior = session ? { set: session.set, reversePorts: [...session.reversePorts] } : null;
      if (!session) {
        let previous: string | null = null;
        try {
          const read = await this.proxies().readProxy(udid);
          const leftover =
            read === setting ||
            (await isDeadCaptureProxy(read, Container.get(PortAllocator).rangeOf('proxy')));
          if (leftover) {
            this.logger.info(`[${sessionId}] ${udid} had a proxy left by an earlier run (${read})`);
          }
          previous = isUnsetProxy(read) || leftover ? null : read;
        } catch (err: any) {
          this.logger.warn(`Could not read the proxy of ${udid}: ${err?.message ?? err}`);
        }
        session = { udid, previous, set: setting, reversePorts: [] };
        this.sessions.set(sessionId, session);
      }
      session.set = setting;
      if (route.reverse && !session.reversePorts.includes(port)) session.reversePorts.push(port);
      // Written down before the change: a crash after it must still find it.
      await this.noteProxy(sessionId, session);
      try {
        await this.proxies().setProxy(udid, route.deviceHost, port);
      } catch (err) {
        if (prior) {
          // A later move that failed: the phone still points where it did, so
          // the record does too, without this port's reverse (its caller
          // removes it). A first call's failure is its caller's to release:
          // whether the phone took the setting isn't known.
          session.set = prior.set;
          session.reversePorts = prior.reversePorts;
          await this.noteProxy(sessionId, session);
        }
        throw err;
      }
    });
  }

  private async noteProxy(sessionId: string, session: PointedSession): Promise<void> {
    await Container.get(PhoneNetworkLedger).note(sessionId, session.udid, {
      proxy: {
        set: session.set,
        previous: session.previous,
        ...(session.reversePorts.length > 0 ? { reversePorts: [...session.reversePorts] } : {}),
      },
    });
  }

  /**
   * Puts back the proxy the phone had before the session and removes every
   * reverse port, once. A phone that can't be reached keeps its record, and is
   * put back at its next session or at this server's next start.
   */
  async release(sessionId: string, opts: LockOptions = {}): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    const { udid } = session;
    await underLock(udid, opts, async () => {
      try {
        await this.proxies().restoreProxy(udid, session.previous);
        for (const port of session.reversePorts) {
          try {
            await this.proxies().removeReverse(udid, port);
          } catch (err: any) {
            this.logger.warn(
              `adb reverse --remove failed for ${udid}:${port}: ${err?.message ?? err}`,
            );
          }
        }
        await Container.get(PhoneNetworkLedger).settle(sessionId, 'proxy');
      } catch (err: any) {
        this.logger.warn(
          `Could not put back the proxy of ${udid} after session ${sessionId}: ` +
            `${err?.message ?? err}. Xenon tries again at the phone's next session and when it restarts.`,
        );
      }
    });
  }
}

/**
 * `lockHeld`: the caller already holds the phone's network lock
 * (withPhoneNetworkLock), which isn't reentrant: NetworkConditioningService
 * calls these from inside it.
 */
export interface LockOptions {
  lockHeld?: boolean;
}

function underLock(udid: string, opts: LockOptions, fn: () => Promise<void>): Promise<void> {
  return opts.lockHeld ? fn() : withPhoneNetworkLock(udid, fn);
}

function firstNonLoopbackIPv4(): string | null {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return null;
}
