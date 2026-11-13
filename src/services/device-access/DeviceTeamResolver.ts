import { Service } from 'typedi';
import log from '../../logger';
import { findPhoneRowsInStore } from '../../middleware/controlDevice';
import { isDeviceVisible } from './deviceVisibility';

/**
 * A phone's team as the live events see it. `known: false` is a phone the
 * store doesn't have, or a udid more than one server reports, named without
 * a host or with a host none of them has (which phone it is can't be told).
 */
export type DeviceTeam = { known: true; teamId: string | null } | { known: false };

export interface DeviceTeamResolverDeps {
  /**
   * Every Device row of a udid, on any host. Defaults to the store lookup
   * findPhone uses (findPhoneRowsInStore).
   */
  findRows?(udid: string): Promise<Array<{ host?: string | null; teamId?: string | null }>>;
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

/** Bound so stray phones can't grow the cache without limit. */
const MAX_ENTRIES = 1_000;

const UNKNOWN: DeviceTeam = { known: false };

interface Entry {
  team: Promise<DeviceTeam>;
  /** When the answer arrived; undefined while the lookup is in flight. */
  settledAt?: number;
  /**
   * The udid, when the answer is its only row's for a host no row has
   * (phoneOf's fallback): a note on that row's host replaces it too.
   */
  byOnlyRowOf?: string;
}

/**
 * Whether a caller with `teamIds` may see a device on `team`. A device the
 * store doesn't know is nobody's shared pool: it is hidden from every member
 * and shown only to an unscoped caller (fail closed).
 */
export function canSeeDeviceTeam(team: DeviceTeam, teamIds: string[] | undefined): boolean {
  return team.known ? isDeviceVisible(team.teamId, teamIds) : teamIds === undefined;
}

/** The cache key of a phone: its udid and host, or the udid alone (`udid@`). */
function phoneCacheKey(udid: string, host: string | undefined): string {
  return `${udid}@${host ?? ''}`;
}

/**
 * Maps a phone to its team for the team-scoped dashboard events.
 *
 * A Device row is keyed by udid and host, and an emulator's udid repeats
 * across servers (a hub and its node can both report emulator-5554), so a
 * phone is named by both. With a host it is that row's team. When no row of
 * the udid has that host (a recording's phone whose server has changed
 * address since) it is the udid's only row's team, as phoneRowsOf decides a
 * recording's phone, else unknown. Without a host it is resolved as findPhone
 * resolves it: the udid's one row, else unknown (none, or two or more, which
 * sends the event to admins only).
 *
 * Session commands and intercepted requests emit one event each, so the answer
 * is cached per phone (udid and host, or the udid alone) for
 * {@link DEVICE_TEAM_TTL_MS}: one store lookup per phone per few seconds,
 * never one per command. Concurrent lookups of one phone share a single
 * call, and unknown phones are cached too.
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

  /**
   * The team of the phone `udid` and `host` name. An empty host is no host:
   * the udid alone.
   */
  resolve(udid: string | null | undefined, host?: string | null): Promise<DeviceTeam> {
    if (!udid) return Promise.resolve(UNKNOWN);
    const pinned = host ? host : undefined;
    const key = phoneCacheKey(udid, pinned);
    const entry = this.entries.get(key);
    if (
      entry &&
      (entry.settledAt === undefined || this.now() - entry.settledAt < DEVICE_TEAM_TTL_MS)
    ) {
      return entry.team;
    }
    return this.load(key, udid, pinned);
  }

  /**
   * A fresher answer for one phone, from a device row in hand or a team
   * change. Replaces that phone's cached answer, and drops the udid's
   * host-less one and those decided by its only row, which may have been
   * this phone's: they are looked up again.
   */
  note(udid: string, host: string, teamId: string | null): void {
    if (!udid || !host) return;
    this.entries.delete(phoneCacheKey(udid, undefined));
    for (const [key, entry] of this.entries) {
      if (entry.byOnlyRowOf === udid) this.entries.delete(key);
    }
    this.remember(phoneCacheKey(udid, host), {
      team: Promise.resolve({ known: true, teamId }),
      settledAt: this.now(),
    });
  }

  private load(key: string, udid: string, host: string | undefined): Promise<DeviceTeam> {
    const entry: Entry = { team: Promise.resolve(UNKNOWN) };
    const forget = (): DeviceTeam => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      return UNKNOWN;
    };
    const phone = host === undefined ? udid : `${udid} at ${host}`;
    const timeoutMs = this.deps.lookupTimeoutMs ?? DEVICE_TEAM_LOOKUP_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
      timer.unref?.();
    });
    const lookup = new Promise<Array<{ host?: string | null; teamId?: string | null }>>((resolve) =>
      resolve(this.findRows(udid)),
    );
    entry.team = Promise.race([lookup, timedOut]).then(
      (rows): DeviceTeam => {
        clearTimeout(timer);
        if (rows === 'timeout') {
          log.warn(
            `[DeviceTeamResolver] team lookup for ${phone} took over ${timeoutMs} ms; ` +
              'its event went to admins only',
          );
          return forget();
        }
        entry.settledAt = this.now();
        const found = phoneOf(rows ?? [], host);
        if (!found) return UNKNOWN;
        if (found.byOnlyRow) entry.byOnlyRowOf = udid;
        return { known: true, teamId: found.row.teamId ?? null };
      },
      (): DeviceTeam => {
        clearTimeout(timer);
        return forget();
      },
    );
    this.remember(key, entry);
    return entry.team;
  }

  private remember(key: string, entry: Entry): void {
    if (this.entries.size >= MAX_ENTRIES && !this.entries.has(key)) this.entries.clear();
    this.entries.set(key, entry);
  }

  private findRows(udid: string) {
    return (this.deps.findRows ?? findPhoneRowsInStore)(udid);
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }
}

/**
 * The row a phone names among its udid's rows: the row with exactly that host
 * (as findPhone matches it), else the udid's only row (`byOnlyRow` when a
 * host was named and no row has it, as phoneRowsOf decides). Two or more rows
 * and none with the host name no row: which phone it is can't be told.
 */
function phoneOf<T extends { host?: string | null }>(
  rows: T[],
  host: string | undefined,
): { row: T; byOnlyRow: boolean } | undefined {
  const exact = host === undefined ? undefined : rows.find((row) => row.host === host);
  if (exact) return { row: exact, byOnlyRow: false };
  return rows.length === 1 ? { row: rows[0], byOnlyRow: host !== undefined } : undefined;
}
