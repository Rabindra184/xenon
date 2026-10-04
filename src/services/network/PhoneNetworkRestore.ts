import { Container, Service } from 'typedi';
import log from '../../logger';
import { PortAllocator } from '../PortAllocator';
import { AndroidProxyAdapter } from '../interceptor/AndroidProxyAdapter';
import { adbForPhone } from './adbForPhone';
import { AndroidRadios } from './AndroidRadios';
import { PhoneNetworkChange, PhoneNetworkLedger } from './PhoneNetworkLedger';
import { withPhoneNetworkLock } from './phoneNetworkLock';
import { isDeadCaptureProxy, parseProxySetting } from './xenonProxy';

/** A record that still can't be undone after this long is dropped: the phone is gone. */
export const LEFTOVER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Puts a phone's network back after a session that changed it: a network
 * profile (`Offline` turns Wi-Fi and mobile data off) or the network
 * interceptor (the phone's global HTTP proxy). Both change the whole phone,
 * not one app, so a phone left that way has no network for the next test.
 *
 * Every way a session ends on this server calls restoreSession, before the
 * phone is released so the next session can't have its own changes undone:
 * the test's delete (SessionLifecycleService.deleteSession), Appium's own end
 * of a session (its new-command timeout, a crashed driver: the plugin's
 * onUnexpectedShutdown), Xenon's idle release (releaseBlockedDevices), a
 * stale heartbeat (OrphanSweeper) and a graceful shutdown. It is keyed by the
 * session id alone, so it works for sessions Xenon keeps no other record of
 * (SESSION_MANAGER holds a local session only with the dashboard or video on).
 *
 * Once per session: a second ending finds the first one's work in progress
 * and waits for it, and a later one finds nothing to do.
 *
 * What a crash forgets, PhoneNetworkLedger remembers. restoreLeftovers undoes
 * it at this server's next start (cleanUpAtBoot) and before the phone's next
 * session here (a phone that was unplugged when its session ended).
 */
@Service()
export class PhoneNetworkRestore {
  private readonly logger = log.scope('PhoneNetwork');
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly radios = new AndroidRadios(adbForPhone);
  private readonly proxies = new AndroidProxyAdapter(adbForPhone);

  /** Undoes what the session changed on its phone's network, once. Never throws. */
  restoreSession(sessionId: string | null | undefined, why: string): Promise<void> {
    if (!sessionId) return Promise.resolve();
    const running = this.inflight.get(sessionId);
    if (running) return running;
    const work = this.undoSession(sessionId, why).finally(() => this.inflight.delete(sessionId));
    this.inflight.set(sessionId, work);
    return work;
  }

  /** Every session this server still has network changes for (shutdown). Never throws. */
  async restoreAll(why: string): Promise<void> {
    const { net, icp } = await this.services();
    const ids = new Set([...net.sessionIds(), ...icp.sessionIds(), ...this.inflight.keys()]);
    await Promise.all([...ids].map((id) => this.restoreSession(id, why)));
  }

  /**
   * Undoes what the ledger says ended sessions left on their phones: one
   * phone's (`udid`) or every phone's. Skips sessions this server still runs.
   * A record that can't be undone now (the phone isn't connected) is kept for
   * next time, for a week. Returns how many records were fully undone.
   * Never throws.
   */
  async restoreLeftovers(opts: { udid?: string } = {}): Promise<number> {
    let done = 0;
    try {
      const ledger = Container.get(PhoneNetworkLedger);
      const entries = (await ledger.list()).filter((e) => !opts.udid || e.udid === opts.udid);
      for (const entry of entries) {
        if (await this.isLive(entry.sessionId)) continue;
        if (await this.undoLeftover(entry.sessionId, entry.udid)) done++;
      }
    } catch (err: any) {
      this.logger.warn(`Could not put back what earlier sessions left: ${err?.message ?? err}`);
    }
    return done;
  }

  /**
   * At this server's start: first what the ledger holds, then each of this
   * server's Android phones (`udids`) whose proxy is a capture an earlier run
   * left (this machine, one of this server's capture ports, nothing answering
   * there; such a phone has no network). That second check also catches a
   * crash from before the ledger existed. A proxy that points anywhere else,
   * or at a capture that is running, is left alone. Never throws.
   */
  async cleanUpAtBoot(udids: string[]): Promise<void> {
    await this.restoreLeftovers({});
    let range: [number, number];
    try {
      range = Container.get(PortAllocator).rangeOf('proxy');
    } catch (err: any) {
      this.logger.warn(`Could not check the phones' proxies: ${err?.message ?? err}`);
      return;
    }
    for (const udid of udids) await this.clearDeadCaptureProxy(udid, range);
  }

  private async undoSession(sessionId: string, why: string): Promise<void> {
    let services: Awaited<ReturnType<PhoneNetworkRestore['services']>>;
    try {
      services = await this.services();
    } catch (err: any) {
      this.logger.warn(`Could not put back the network of session ${sessionId}: ${err?.message}`);
      return;
    }
    const { net, icp } = services;
    const profile = net.has(sessionId);
    const capture = icp.isActive(sessionId);
    if (!profile && !capture) return;
    this.logger.info(`Putting back the phone network of session ${sessionId} (${why})`);
    if (profile) {
      try {
        await net.reset(sessionId);
      } catch (err: any) {
        this.logger.warn(`Network profile reset failed for ${sessionId}: ${err?.message ?? err}`);
      }
    }
    if (capture) {
      try {
        await icp.stop(sessionId);
      } catch (err: any) {
        this.logger.warn(`Interceptor stop failed for ${sessionId}: ${err?.message ?? err}`);
      }
    }
  }

  private async isLive(sessionId: string): Promise<boolean> {
    if (this.inflight.has(sessionId)) return true;
    const { net, icp } = await this.services();
    return net.has(sessionId) || icp.isActive(sessionId);
  }

  /** One record, under the phone's lock, read again there: another clean-up may have done it. */
  private async undoLeftover(sessionId: string, udid: string): Promise<boolean> {
    const ledger = Container.get(PhoneNetworkLedger);
    return await withPhoneNetworkLock(udid, async () => {
      const change = await ledger.get(sessionId);
      if (!change) return false;
      let undone = true;
      if (change.offline && !(await this.undoOffline(change, change.offline))) undone = false;
      if (change.proxy && !(await this.undoProxy(change, change.proxy))) undone = false;
      if (!undone && Date.now() - change.at > LEFTOVER_MAX_AGE_MS) {
        await ledger.forget(sessionId);
        this.logger.warn(
          `Gave up putting back the network of ${udid} (session ${sessionId}): it has not ` +
            'been reachable for a week.',
        );
      }
      return undone;
    });
  }

  private async undoOffline(
    change: PhoneNetworkChange,
    prior: NonNullable<PhoneNetworkChange['offline']>,
  ): Promise<boolean> {
    const { udid, sessionId } = change;
    const which = AndroidRadios.toRestore(prior);
    try {
      await this.radios.turnOn(udid, which);
      await Container.get(PhoneNetworkLedger).settle(sessionId, 'offline');
      const what = [which.wifi && 'Wi-Fi', which.data && 'mobile data']
        .filter(Boolean)
        .join(' and ');
      if (what) {
        this.logger.warn(
          `Turned ${what} back on on ${udid}: session ${sessionId} took the phone offline and ` +
            'ended without putting it back.',
        );
      }
      return true;
    } catch (err: any) {
      this.logger.warn(
        `Could not turn the network back on on ${udid} (session ${sessionId}): ` +
          `${err?.message ?? err}. Trying again at its next session and at the next start.`,
      );
      return false;
    }
  }

  private async undoProxy(
    change: PhoneNetworkChange,
    proxy: NonNullable<PhoneNetworkChange['proxy']>,
  ): Promise<boolean> {
    const { udid, sessionId } = change;
    try {
      const now = (await this.proxies.readProxy(udid)).trim();
      if (now === proxy.set) {
        await this.proxies.restoreProxy(udid, proxy.previous);
        if (proxy.reversePort) await this.removeReverse(udid, proxy.reversePort);
        this.logger.warn(
          `Put back the proxy of ${udid} (${proxy.previous ?? 'none'}): session ${sessionId} ` +
            `pointed it at ${proxy.set} and ended without putting it back.`,
        );
      } else {
        this.logger.info(
          `Left the proxy of ${udid} as it is (${now || 'none'}): it changed after session ` +
            `${sessionId} set ${proxy.set}.`,
        );
      }
      await Container.get(PhoneNetworkLedger).settle(sessionId, 'proxy');
      return true;
    } catch (err: any) {
      this.logger.warn(
        `Could not put back the proxy of ${udid} (session ${sessionId}): ${err?.message ?? err}. ` +
          'Trying again at its next session and at the next start.',
      );
      return false;
    }
  }

  private async clearDeadCaptureProxy(udid: string, range: [number, number]): Promise<void> {
    try {
      await withPhoneNetworkLock(udid, async () => {
        const now = await this.proxies.readProxy(udid);
        const proxy = parseProxySetting(now);
        if (!proxy || !(await isDeadCaptureProxy(now, range))) return;
        await this.proxies.clearProxy(udid);
        if (proxy.host === '127.0.0.1' || proxy.host.toLowerCase() === 'localhost') {
          await this.removeReverse(udid, proxy.port);
        }
        this.logger.warn(
          `Cleared the proxy of ${udid} (${now.trim()}): it pointed at this machine's network ` +
            `capture port ${proxy.port}, where nothing answers, so the phone had no network.`,
        );
      });
    } catch (err: any) {
      this.logger.debug(`Could not check the proxy of ${udid}: ${err?.message ?? err}`);
    }
  }

  private async removeReverse(udid: string, port: number): Promise<void> {
    try {
      await this.proxies.removeReverse(udid, port);
    } catch {
      // Gone with the adb server or the connection: nothing to remove.
    }
  }

  /** Imported lazily: InterceptorService pulls in the socket server. */
  private async services() {
    const [{ NetworkConditioningService }, { InterceptorService }] = await Promise.all([
      import('../NetworkConditioningService'),
      import('../InterceptorService'),
    ]);
    return {
      net: Container.get(NetworkConditioningService),
      icp: Container.get(InterceptorService),
    };
  }
}
