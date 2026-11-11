import { Container, Service } from 'typedi';
import log from '../logger';
import { IDevice } from '../interfaces/IDevice';
import { adbForPhone } from './network/adbForPhone';
import { AndroidRadios, RadioState } from './network/AndroidRadios';
import { PhoneNetworkLedger } from './network/PhoneNetworkLedger';
import { withPhoneNetworkLock } from './network/phoneNetworkLock';
import {
  EmulatorConsole,
  EmulatorShape,
  UNSHAPED,
  emulatorConsolePort,
} from './network/EmulatorConsole';

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

/** The profiles a session may ask for, in the order the docs list them. */
export const NETWORK_PROFILE_NAMES: readonly NetworkProfile[] = [
  'Normal',
  '4G',
  '3G',
  'Edge',
  'Offline',
];

export function isNetworkProfile(value: unknown): value is NetworkProfile {
  return typeof value === 'string' && (NETWORK_PROFILE_NAMES as readonly string[]).includes(value);
}

/** The profiles whose figures shape an emulator's traffic. */
const SHAPING_PROFILES: readonly NetworkProfile[] = ['4G', '3G', 'Edge'];

/** The emulator shape a profile asks for: its figures, or no limit for Normal. */
function shapeFor(profile: NetworkProfile): EmulatorShape {
  const c = NETWORK_PROFILES[profile];
  if (!c || !SHAPING_PROFILES.includes(profile)) return UNSHAPED;
  return {
    upKbps: c.uploadKbps,
    downKbps: c.downloadKbps,
    minLatencyMs: c.latencyMs,
    maxLatencyMs: c.latencyMs,
  };
}

/**
 * What a profile did to the device's own network:
 * - `shaped`: the app's traffic is slowed to the profile's figures (an
 *   Android emulator's console);
 * - `radios`: Wi-Fi and mobile data were switched (Android `Offline` and
 *   `Normal`);
 * - `none`: nothing on the device; only each Appium command is delayed.
 */
export type AppTraffic = 'shaped' | 'radios' | 'none';

export interface ProfileOutcome {
  profile: NetworkProfile;
  appTraffic: AppTraffic;
  /** The delay added to each of the session's Appium commands. */
  commandDelayMs: number;
}

interface ActiveCondition {
  profile: NetworkProfile;
  device: IDevice;
  /** While Offline has the radios off: what they were before. */
  offlinePrior?: RadioState;
  /** Once a profile shaped the emulator: the shape it had before. */
  shapePrior?: EmulatorShape;
}

/**
 * A session's network profile: set at start (`xe:network_profile`) and
 * changed during the session (`xenon: setNetworkProfile`, ENH-20).
 *
 * - Every profile's delay is added to each of the session's commands by the
 *   session gateway (getLatency), as before.
 * - On an Android phone `Offline` turns mobile data and Wi-Fi off, and
 *   leaving it turns back on what was on; `Normal` turns them on.
 * - On an Android emulator this server drives, `4G`, `3G` and `Edge` also
 *   slow the app's own traffic to the profile's figures, through the
 *   emulator's console (EmulatorConsole), and `Normal` lifts that. Measured
 *   on the lab's emulator: a TCP request went from ~45 ms to ~2 s at 500 ms
 *   and 20 kbps. ICMP isn't shaped.
 * - A real phone's traffic isn't shaped: that needs a shaping proxy. An
 *   iPhone, real or simulated, gets the delay only: Xcode has no command to
 *   change a simulator's network (`xcrun simctl` has no `network`
 *   subcommand in Xcode 26), and a real iPhone's can't be changed from a Mac.
 *
 * What a session changed is undone when it ends, however it ends
 * (PhoneNetworkRestore): the radios to what they were before its first
 * `Offline`, the emulator to its shape before its first shaping. Each is
 * written down first (PhoneNetworkLedger), so a restart can undo it after a
 * crash. A phone's changes are made one at a time (withPhoneNetworkLock).
 */
@Service()
export class NetworkConditioningService {
  private log = log.scope('NetworkConditioning');
  private activeConditions: Map<string, ActiveCondition> = new Map();
  private radios = new AndroidRadios(adbForPhone);
  private toldAboutIPhones = false;
  private consoleWarned = new Set<string>();
  /** The emulator console for a port. A field, so a spec can stand in for it. */
  consoleFor: (port: number) => EmulatorConsole = (port) => new EmulatorConsole(port);

  /** Applies the profile a session starts with (`xe:network_profile`). */
  public async applyProfile(sessionId: string, device: IDevice, profile: NetworkProfile) {
    return this.setProfile(sessionId, device, profile);
  }

  /**
   * Sets the session's profile, at start or during the session, and answers
   * what it did. Never throws for the device: a change that fails is logged,
   * and the answer says what took effect.
   */
  public async setProfile(
    sessionId: string,
    device: IDevice,
    profile: NetworkProfile,
  ): Promise<ProfileOutcome> {
    if (!isNetworkProfile(profile)) {
      throw new Error(
        `Unknown network profile ${JSON.stringify(profile)}: use one of ${NETWORK_PROFILE_NAMES.join(', ')}.`,
      );
    }
    this.log.info(
      `Applying network profile '${profile}' to session ${sessionId} on device ${device.udid}`,
    );
    let condition = this.activeConditions.get(sessionId);
    if (!condition) {
      condition = { profile, device };
      this.activeConditions.set(sessionId, condition);
    }
    condition.profile = profile;

    let appTraffic: AppTraffic = 'none';
    if (device.platform?.toLowerCase() === 'android') {
      await withPhoneNetworkLock(device.udid, async () => {
        if (await this.setRadios(sessionId, condition as ActiveCondition, profile)) {
          appTraffic = 'radios';
        }
        if (await this.setShape(sessionId, condition as ActiveCondition, profile)) {
          appTraffic = 'shaped';
        }
      });
    } else if (!this.toldAboutIPhones) {
      this.toldAboutIPhones = true;
      this.log.info(
        'Network profiles on iPhones and iOS simulators only delay each command: the ' +
          "device's own network isn't changed, so Offline leaves it online.",
      );
    }
    return { profile, appTraffic, commandDelayMs: NETWORK_PROFILES[profile]?.latencyMs || 0 };
  }

  /** The session's profile and what it does now, or undefined when it has none. */
  public describe(sessionId: string): ProfileOutcome | undefined {
    const condition = this.activeConditions.get(sessionId);
    if (!condition) return undefined;
    const { profile, device } = condition;
    const android = device.platform?.toLowerCase() === 'android';
    const appTraffic: AppTraffic = !android
      ? 'none'
      : condition.shapePrior && SHAPING_PROFILES.includes(profile)
        ? 'shaped'
        : profile === 'Offline' || profile === 'Normal'
          ? 'radios'
          : 'none';
    return { profile, appTraffic, commandDelayMs: NETWORK_PROFILES[profile]?.latencyMs || 0 };
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

    const { offlinePrior, shapePrior } = condition;
    if (!offlinePrior && !shapePrior) return;
    const udid = condition.device.udid;
    await withPhoneNetworkLock(udid, async () => {
      if (offlinePrior) {
        try {
          await this.radios.turnOn(udid, AndroidRadios.toRestore(offlinePrior));
          await Container.get(PhoneNetworkLedger).settle(sessionId, 'offline');
          this.log.info(`📱 Android: network put back on ${udid} after session ${sessionId}`);
        } catch (e: any) {
          this.log.warn(
            `⚠️ Could not put the network back on ${udid} after session ${sessionId}: ${e?.message}. ` +
              "Xenon tries again at the phone's next session and when it restarts.",
          );
        }
      }
      const port = emulatorConsolePort(condition.device);
      if (shapePrior && port) {
        try {
          await this.consoleFor(port).applyShape(shapePrior);
          await Container.get(PhoneNetworkLedger).settle(sessionId, 'emulatorShape');
          this.log.info(
            `📱 Emulator: network shaping put back on ${udid} after session ${sessionId}`,
          );
        } catch (e: any) {
          this.log.warn(
            `⚠️ Could not put back the network shaping of ${udid} after session ${sessionId}: ` +
              `${e?.message}. Xenon tries again at the phone's next session and when it restarts.`,
          );
        }
      }
    });
  }

  /**
   * The radios for `profile`: off for Offline (recording what was on, once),
   * back to what was on when leaving Offline, both on for Normal. Answers
   * whether the radios were switched. Runs under the phone's lock.
   */
  private async setRadios(
    sessionId: string,
    condition: ActiveCondition,
    profile: NetworkProfile,
  ): Promise<boolean> {
    const udid = condition.device.udid;
    try {
      if (profile === 'Offline') {
        if (!condition.offlinePrior) {
          const prior = await this.radios.read(udid);
          // Written down before the change: a crash after it must still find it.
          await Container.get(PhoneNetworkLedger).note(sessionId, udid, { offline: prior });
          condition.offlinePrior = prior;
          this.log.info(`📱 Android: turning mobile data and Wi-Fi off on ${udid}`);
          await this.radios.turnOff(udid);
        }
        return true;
      }
      if (condition.offlinePrior) {
        const prior = condition.offlinePrior;
        this.log.info(`📱 Android: turning back on what was on on ${udid}`);
        await this.radios.turnOn(udid, AndroidRadios.toRestore(prior));
        condition.offlinePrior = undefined;
        await Container.get(PhoneNetworkLedger).settle(sessionId, 'offline');
        return true;
      }
      if (profile === 'Normal') {
        this.log.info(`📱 Android: turning mobile data and Wi-Fi on on ${udid}`);
        await this.radios.turnOn(udid, { data: true, wifi: true });
        return true;
      }
      return false;
    } catch (e: any) {
      this.log.warn(`⚠️ Failed to apply Android conditioning for ${udid}: ${e?.message}`);
      return false;
    }
  }

  /**
   * An emulator's shaping for `profile`, through its console: the profile's
   * figures for 4G, 3G and Edge, no limit for Normal. The shape it had is read
   * and written down before the first change; until a profile shapes it, the
   * console isn't touched. Offline leaves the shaping as it is. Answers
   * whether the app's traffic is shaped. Runs under the phone's lock.
   */
  private async setShape(
    sessionId: string,
    condition: ActiveCondition,
    profile: NetworkProfile,
  ): Promise<boolean> {
    const port = emulatorConsolePort(condition.device);
    if (!port || profile === 'Offline') return false;
    const shaping = SHAPING_PROFILES.includes(profile);
    if (!shaping && !condition.shapePrior) return false;
    const udid = condition.device.udid;
    try {
      const emulator = this.consoleFor(port);
      if (!condition.shapePrior) {
        const prior = await emulator.readShape();
        await Container.get(PhoneNetworkLedger).note(sessionId, udid, { emulatorShape: prior });
        condition.shapePrior = prior;
      }
      await emulator.applyShape(shapeFor(profile));
      this.log.info(
        `📱 Emulator: ${udid} network ${shaping ? `shaped to ${profile}` : 'unshaped'}`,
      );
      return shaping;
    } catch (e: any) {
      if (!this.consoleWarned.has(udid)) {
        this.consoleWarned.add(udid);
        this.log.warn(
          `⚠️ Could not shape the network of emulator ${udid} through its console: ${e?.message}. ` +
            'Its profile only delays each command.',
        );
      }
      return false;
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
