import { Service } from 'typedi';
import log from '../../logger';
import { findControlDeviceInStore } from '../../middleware/controlDevice';
import { isDeviceVisible } from './deviceVisibility';

/** A device's team as the live events see it. `known: false` is a udid the store doesn't have. */
export type DeviceTeam = { known: true; teamId: string | null } | { known: false };

export interface DeviceTeamResolverDeps {
  /** Finds one device. Defaults to the store lookup the /control guards use. */
  findDevice?(udid: string): Promise<{ teamId?: string | null } | null | undefined>;
  now?(): number;
  /** Overrides DEVICE_TEAM_LOOKUP_TIMEOUT_MS. */
  lookupTimeoutMs?: number;
}

/** How long an answer is reused. A team change made outside assignDeviceToTeam shows after this. */
export const DEVICE_TEAM_TTL_MS = 5_000;

/**
 * How long one store lookup may take. Past it the event fails closed (admins
 * only) and the phone's delivery chain moves on; the answer isn't cached.
 */
export const DEVICE_TEAM_LOOKUP_TIMEOUT_MS = 2_000;

/** Bound so stray udids can't grow the cache without limit. */
const MAX_ENTRIES = 1_000;

const UNKNOWN: DeviceTeam = { known: false };

interface Entry {
  team: Promise<DeviceTeam>;
  /** When the answer arrived; undefined while the lookup is in flight. */
  settledAt?: number;
}

/**
 * Whether a caller with `teamIds` may see a device on `team`. A device the
 * store doesn't know is nobody's shared pool: it is hidden from every member
 * and shown only to an unscoped caller (fail closed).
 */
export function canSeeDeviceTeam(team: DeviceTeam, teamIds: string[] | undefined): boolean {
  return team.known ? isDeviceVisible(team.teamId, teamIds) : teamIds === undefined;
}

/**
 * Maps a udid to its team for the team-scoped dashboard events.
 *
 * Session commands and intercepted requests emit one event each, so the answer
 * is cached for {@link DEVICE_TEAM_TTL_MS}: one store lookup per phone per few
 * seconds, never one per command. Concurrent lookups of one udid share a
 * single call, and unknown udids are cached too.
 *
 * It keeps no delivery order: SocketServer delivers each phone's events
 * through one chain, in the order they were emitted.
 *
 * Device events and team changes call {@link note} with the row they hold, so
 * the cache doesn't wait out its TTL. A lookup that fails, or outlasts
 * {@link DEVICE_TEAM_LOOKUP_TIMEOUT_MS}, resolves to unknown (hidden from
 * members) and isn't cached.
 */
@Service()
export class DeviceTeamResolver {
  private readonly entries = new Map<string, Entry>();

  // An interface-typed parameter emits `Object`, which TypeDI leaves alone; a
  // function-typed one would make Container.get throw.
  constructor(private readonly deps: DeviceTeamResolverDeps = {}) {}

  resolve(udid: string | null | undefined): Promise<DeviceTeam> {
    if (!udid) return Promise.resolve(UNKNOWN);
    const entry = this.entries.get(udid);
    if (
      entry &&
      (entry.settledAt === undefined || this.now() - entry.settledAt < DEVICE_TEAM_TTL_MS)
    ) {
      return entry.team;
    }
    return this.load(udid);
  }

  /** A fresher answer, from a device row in hand or a team change. Replaces the cached one. */
  note(udid: string, teamId: string | null): void {
    if (!udid) return;
    this.remember(udid, { team: Promise.resolve({ known: true, teamId }), settledAt: this.now() });
  }

  private load(udid: string): Promise<DeviceTeam> {
    const entry: Entry = { team: Promise.resolve(UNKNOWN) };
    const forget = (): DeviceTeam => {
      if (this.entries.get(udid) === entry) this.entries.delete(udid);
      return UNKNOWN;
    };
    const timeoutMs = this.deps.lookupTimeoutMs ?? DEVICE_TEAM_LOOKUP_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
      timer.unref?.();
    });
    const lookup = new Promise<{ teamId?: string | null } | null | undefined>((resolve) =>
      resolve(this.findDevice(udid)),
    );
    entry.team = Promise.race([lookup, timedOut]).then(
      (row): DeviceTeam => {
        clearTimeout(timer);
        if (row === 'timeout') {
          log.warn(
            `[DeviceTeamResolver] team lookup for ${udid} took over ${timeoutMs} ms; ` +
              'its event went to admins only',
          );
          return forget();
        }
        entry.settledAt = this.now();
        return row ? { known: true, teamId: row.teamId ?? null } : UNKNOWN;
      },
      (): DeviceTeam => {
        clearTimeout(timer);
        return forget();
      },
    );
    this.remember(udid, entry);
    return entry.team;
  }

  private remember(udid: string, entry: Entry): void {
    if (this.entries.size >= MAX_ENTRIES && !this.entries.has(udid)) this.entries.clear();
    this.entries.set(udid, entry);
  }

  private findDevice(udid: string) {
    return (this.deps.findDevice ?? findControlDeviceInStore)(udid);
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }
}
