import { Container, Service } from 'typedi';
import log from '../logger';
import { IDevice } from '../interfaces/IDevice';
import { adbForPhone } from './network/adbForPhone';
import { AndroidRadios, RadioState } from './network/AndroidRadios';
import { PhoneNetworkLedger } from './network/PhoneNetworkLedger';
import { withPhoneNetworkLock } from './network/phoneNetworkLock';

export type NetworkProfile = '4G' | '3G' | 'Edge' | 'Offline' | 'Normal';

export interface NetworkCondition {
  latencyMs: number;
  downloadKbps: number;
  uploadKbps: number;
}

const NETWORK_PROFILES: Record<NetworkProfile, NetworkCondition | null> = {
  Normal: null,
  '4G': { latencyMs: 20, downloadKbps: 15000, uploadKbps: 7500 },
  '3G': { latencyMs: 100, downloadKbps: 2000, uploadKbps: 1000 },
  Edge: { latencyMs: 400, downloadKbps: 250, uploadKbps: 150 },
  Offline: { latencyMs: 0, downloadKbps: 0, uploadKbps: 0 },
};

interface ActiveCondition {
  profile: NetworkProfile;
  device: IDevice;
  /** Set when Offline turned the phone's radios off: what they were before. */
  offlinePrior?: RadioState;
}

/**
 * A session's network profile (`xe:network_profile`).
 *
 * Every profile's delay is added to each of the session's commands by the
 * session gateway (getLatency). On an Android phone `Offline` also turns
 * mobile data and Wi-Fi off, and `Normal` turns them on; 4G, 3G and Edge
 * change nothing on the phone. An iPhone, real or simulated, gets the delay
 * only: Xcode has no command to change a simulator's network (`xcrun simctl`
 * has no `network` subcommand in Xcode 26), and a real iPhone's can't be
 * changed from a Mac.
 *
 * What `Offline` changed is undone when the session ends, however it ends
 * (PhoneNetworkRestore), and written down meanwhile (PhoneNetworkLedger) so a
 * restart can undo it after a crash.
 */
@Service()
export class NetworkConditioningService {
  private log = log.scope('NetworkConditioning');
  private activeConditions: Map<string, ActiveCondition> = new Map();
  private radios = new AndroidRadios(adbForPhone);
  private toldAboutIPhones = false;

  /**
   * Applies a network profile to a session/device
   */
  public async applyProfile(sessionId: string, device: IDevice, profile: NetworkProfile) {
    this.log.info(
      `Applying network profile '${profile}' to session ${sessionId} on device ${device.udid}`,
    );
    const condition: ActiveCondition = { profile, device };
    this.activeConditions.set(sessionId, condition);

    if (device.platform?.toLowerCase() === 'android') {
      if (profile === 'Offline') await this.takeOffline(sessionId, condition);
      else if (profile === 'Normal') await this.turnOnline(device.udid);
      // 4G, 3G and Edge: the delay only.
    } else if (!this.toldAboutIPhones) {
      this.toldAboutIPhones = true;
      this.log.info(
        'Network profiles on iPhones and iOS simulators only delay each command: the ' +
          "device's own network isn't changed, so Offline leaves it online.",
      );
    }
  }

  /**
   * Gets the active profile for a session
   */
  public getProfile(sessionId: string): NetworkProfile | undefined {
    return this.activeConditions.get(sessionId)?.profile;
  }

  /** Whether the session has a profile on this server. */
  public has(sessionId: string): boolean {
    return this.activeConditions.has(sessionId);
  }

  /** The sessions with a profile on this server. */
  public sessionIds(): string[] {
    return [...this.activeConditions.keys()];
  }

  /**
   * Ends the session's profile and undoes what it changed on the phone, once:
   * the entry is taken before anything is awaited, so a second call finds
   * nothing to do. A phone that can't be reached keeps its record in the
   * ledger, and is put back at its next session or this server's next start.
   */
  public async reset(sessionId: string) {
    const condition = this.activeConditions.get(sessionId);
    if (!condition) return;
    this.activeConditions.delete(sessionId);
    this.log.info(`Resetting network conditions for session ${sessionId}`);

    const prior = condition.offlinePrior;
    if (!prior) return;
    const udid = condition.device.udid;
    await withPhoneNetworkLock(udid, async () => {
      try {
        await this.radios.turnOn(udid, AndroidRadios.toRestore(prior));
        await Container.get(PhoneNetworkLedger).settle(sessionId, 'offline');
        this.log.info(`📱 Android: network put back on ${udid} after session ${sessionId}`);
      } catch (e: any) {
        this.log.warn(
          `⚠️ Could not put the network back on ${udid} after session ${sessionId}: ${e?.message}. ` +
            "Xenon tries again at the phone's next session and when it restarts.",
        );
      }
    });
  }

  private async takeOffline(sessionId: string, condition: ActiveCondition): Promise<void> {
    const udid = condition.device.udid;
    try {
      await withPhoneNetworkLock(udid, async () => {
        const prior = await this.radios.read(udid);
        // Written down before the change: a crash after it must still find it.
        await Container.get(PhoneNetworkLedger).note(sessionId, udid, { offline: prior });
        condition.offlinePrior = prior;
        this.log.info(`📱 Android: turning mobile data and Wi-Fi off on ${udid}`);
        await this.radios.turnOff(udid);
      });
    } catch (e: any) {
      this.log.warn(`⚠️ Failed to apply Android conditioning for ${udid}: ${e?.message}`);
    }
  }

  private async turnOnline(udid: string): Promise<void> {
    try {
      await withPhoneNetworkLock(udid, async () => {
        this.log.info(`📱 Android: turning mobile data and Wi-Fi on on ${udid}`);
        await this.radios.turnOn(udid, { data: true, wifi: true });
      });
    } catch (e: any) {
      this.log.warn(`⚠️ Failed to apply Android conditioning for ${udid}: ${e?.message}`);
    }
  }

  /**
   * Returns the latency to inject into a command proxy for the given profile
   */
  public getLatency(sessionId: string): number {
    const condition = this.activeConditions.get(sessionId);
    if (!condition) return 0;
    return NETWORK_PROFILES[condition.profile]?.latencyMs || 0;
  }
}
