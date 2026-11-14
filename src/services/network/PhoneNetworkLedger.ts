import { Service } from 'typedi';
import AsyncLock from 'async-lock';
import { prisma } from '../../prisma';
import log from '../../logger';
import type { RadioState } from './AndroidRadios';
import type { EmulatorShape } from './EmulatorConsole';

/** What a session changed on its phone's network, until it is put back. */
export interface PhoneNetworkChange {
  sessionId: string;
  udid: string;
  /** When the first change was written down (ms since the epoch). */
  at: number;
  /** A profile turned Wi-Fi and mobile data off; whether each was on before. */
  offline?: RadioState;
  /**
   * `Normal` turned on Wi-Fi or mobile data that was off; whether each was on
   * before. Only what was off (`false`) is turned off again.
   */
  radiosOn?: RadioState;
  /**
   * Network capture or traffic shaping (PhoneProxy) set the phone's global
   * HTTP proxy to `set`. `previous` is what the phone had (null: none).
   * `reversePorts` are the `adb reverse` ports the phone reaches Xenon's
   * proxies through. A row from 2.31 or earlier has one `reversePort`, read
   * as `reversePorts: [it]`.
   */
  proxy?: { set: string; previous: string | null; reversePorts?: number[] };
  /**
   * A network profile shaped an emulator's traffic through its console
   * (EmulatorConsole); the shape it had before.
   */
  emulatorShape?: EmulatorShape;
}

export type PhoneNetworkPart = 'offline' | 'radiosOn' | 'proxy' | 'emulatorShape';

const PREFIX = 'phone-network:';

/**
 * The version of the rows this release writes. A row with no version was
 * written by 2.36 or earlier, in this same shape.
 */
export const LEDGER_VERSION = 1;

/** A record that still can't be undone (or read) after this long is dropped: the phone is gone. */
export const LEFTOVER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The fields a version-1 row may hold. Any other is a part a later release added. */
const KNOWN_FIELDS = new Set([
  'v',
  'sessionId',
  'udid',
  'at',
  'offline',
  'radiosOn',
  'proxy',
  'emulatorShape',
]);

/** The reverse ports a stored proxy change names, in this release's form or 2.31's. */
function reversePortsOf(proxy: any): { reversePorts?: number[] } {
  const isPort = (p: unknown): p is number => typeof p === 'number' && Number.isInteger(p) && p > 0;
  if (Array.isArray(proxy.reversePorts)) {
    const ports = proxy.reversePorts.filter(isPort);
    return ports.length > 0 ? { reversePorts: ports } : {};
  }
  return isPort(proxy.reversePort) ? { reversePorts: [proxy.reversePort] } : {};
}

/**
 * Xenon's record of the network changes it made to its phones, kept until
 * each is put back. In memory a session's changes are undone when it ends; a
 * crash or a kill -9 forgets them, and the phone stays offline or pointed at
 * a proxy nobody serves. At its next start the server reads this record and
 * puts those phones back (PhoneNetworkRestore).
 *
 * Kept in this server's own database, which is what makes it this server's:
 * a hub and a node on one machine see the same Android phones, but each has
 * its own database. It has no table of its own: WebConfig is the database's
 * key-value table (MetricsService keeps its counters there), and a new table
 * would mean a migration and a regenerated client for a handful of rows. One
 * row per session, `phone-network:<sessionId>`, holding the JSON above
 * with `v: 1`.
 *
 * A row this release can't read is kept for the release that wrote it: one
 * from a later version, or a version-1 row naming a part this release doesn't
 * know (a downgrade). It is logged once, never undone in part (settling
 * would rewrite the row without the part), and dropped only once it is a
 * week old, as a record that can't be undone is. Through 2.36 rows had no
 * version and every row that couldn't be parsed was deleted at boot. A row
 * with no version that isn't a record is still dropped: no release writes
 * one.
 *
 * A failed write is logged and never fails a session: the change is still
 * made, and undone when the session ends; only a crash before then would
 * leave it.
 */
@Service()
export class PhoneNetworkLedger {
  private readonly logger = log.scope('PhoneNetwork');
  private readonly lock = new AsyncLock();
  /** Rows this release can't read, already logged. */
  private readonly toldUnreadable = new Set<string>();

  /** Adds `part` to the session's record, creating the record if needed. */
  async note(
    sessionId: string,
    udid: string,
    part:
      | Pick<PhoneNetworkChange, 'offline'>
      | Pick<PhoneNetworkChange, 'radiosOn'>
      | Pick<PhoneNetworkChange, 'proxy'>
      | Pick<PhoneNetworkChange, 'emulatorShape'>,
  ): Promise<void> {
    await this.guard(`record a network change for ${udid} (session ${sessionId})`, () =>
      this.lock.acquire(sessionId, async () => {
        const current = await this.read(sessionId);
        const next: PhoneNetworkChange = {
          ...(current ?? { sessionId, udid, at: Date.now() }),
          ...part,
        };
        await this.write(next);
      }),
    );
  }

  /** The part was put back: drops it, and the record once nothing is left. */
  async settle(sessionId: string, part: PhoneNetworkPart): Promise<void> {
    await this.guard(`settle the ${part} change of session ${sessionId}`, () =>
      this.lock.acquire(sessionId, async () => {
        const current = await this.read(sessionId);
        if (!current) return;
        const next = { ...current };
        delete next[part];
        if (next.offline || next.radiosOn || next.proxy || next.emulatorShape) {
          await this.write(next);
        } else await this.remove(sessionId);
      }),
    );
  }

  /** Drops the session's record, whatever it holds. */
  async forget(sessionId: string): Promise<void> {
    await this.guard(`forget the network changes of session ${sessionId}`, () =>
      this.lock.acquire(sessionId, () => this.remove(sessionId)),
    );
  }

  /** The session's record, or null. */
  async get(sessionId: string): Promise<PhoneNetworkChange | null> {
    try {
      return await this.read(sessionId);
    } catch (err: any) {
      this.logger.warn(`Could not read the phone network record: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Every record this release can read, oldest first. A row with no version
   * that isn't a record is dropped; one a later release wrote is kept (see
   * above).
   */
  async list(): Promise<PhoneNetworkChange[]> {
    let rows: Array<{ name: string; value: string }> = [];
    try {
      rows = await prisma.webConfig.findMany({
        where: { name: { startsWith: PREFIX } },
        select: { name: true, value: true },
      });
    } catch (err: any) {
      this.logger.warn(`Could not read the phone network record: ${err?.message ?? err}`);
      return [];
    }
    const out: PhoneNetworkChange[] = [];
    for (const row of rows) {
      const parsed = parseRow(row.value);
      const sessionId = row.name.slice(PREFIX.length);
      if (parsed.kind === 'change') {
        out.push(parsed.change);
      } else if (parsed.kind === 'junk') {
        await this.remove(sessionId).catch(() => undefined);
      } else if (parsed.at !== null && Date.now() - parsed.at > LEFTOVER_MAX_AGE_MS) {
        await this.remove(sessionId).catch(() => undefined);
        this.logger.warn(
          `Dropped the phone network record of session ${sessionId}, which this Xenon can't ` +
            `read (${parsed.why}): it is more than a week old.`,
        );
      } else if (!this.toldUnreadable.has(row.name)) {
        this.toldUnreadable.add(row.name);
        this.logger.warn(
          `Kept the phone network record of session ${sessionId} as it is: this Xenon can't ` +
            `read it (${parsed.why}). The Xenon that wrote it puts the phone back.`,
        );
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  private async read(sessionId: string): Promise<PhoneNetworkChange | null> {
    const row = await prisma.webConfig.findUnique({ where: { name: PREFIX + sessionId } });
    if (!row) return null;
    const parsed = parseRow(row.value);
    if (parsed.kind === 'change') return parsed.change;
    if (parsed.kind === 'unreadable') {
      // A later release's row: never rewritten without the parts it can't read.
      throw new Error(`the record of session ${sessionId} can't be read (${parsed.why})`);
    }
    return null;
  }

  private async write(change: PhoneNetworkChange): Promise<void> {
    const name = PREFIX + change.sessionId;
    const value = JSON.stringify({ v: LEDGER_VERSION, ...change });
    await prisma.webConfig.upsert({
      where: { name },
      update: { value },
      create: { id: name, name, value },
    });
  }

  private async remove(sessionId: string): Promise<void> {
    await prisma.webConfig.deleteMany({ where: { name: PREFIX + sessionId } });
  }

  private async guard(what: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err: any) {
      this.logger.warn(`Could not ${what}: ${err?.message ?? err}`);
    }
  }
}

type ParsedRow =
  | { kind: 'change'; change: PhoneNetworkChange }
  /** Written by a later release, or naming a part this one doesn't know: kept. */
  | { kind: 'unreadable'; why: string; at: number | null }
  /** No version, and not a record: no release writes one. */
  | { kind: 'junk' };

function parseRow(value: string): ParsedRow {
  let v: any;
  try {
    v = JSON.parse(value);
  } catch {
    return { kind: 'junk' };
  }
  if (v && typeof v === 'object' && 'v' in v) {
    const at = typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : null;
    if (v.v !== LEDGER_VERSION) {
      return { kind: 'unreadable', why: `version ${JSON.stringify(v.v)}`, at };
    }
    const unknown = Object.keys(v).filter((k) => !KNOWN_FIELDS.has(k));
    if (unknown.length > 0) {
      return { kind: 'unreadable', why: `unknown parts: ${unknown.join(', ')}`, at };
    }
    const change = parseChange(v);
    return change ? { kind: 'change', change } : { kind: 'unreadable', why: 'malformed', at };
  }
  const change = parseChange(v);
  return change ? { kind: 'change', change } : { kind: 'junk' };
}

function parseChange(v: any): PhoneNetworkChange | null {
  try {
    if (!v || typeof v.sessionId !== 'string' || typeof v.udid !== 'string') return null;
    if (typeof v.at !== 'number') return null;
    const change: PhoneNetworkChange = { sessionId: v.sessionId, udid: v.udid, at: v.at };
    if (v.offline && typeof v.offline === 'object') {
      change.offline = {
        wifiOn: boolOrNull(v.offline.wifiOn),
        dataOn: boolOrNull(v.offline.dataOn),
      };
    }
    if (v.radiosOn && typeof v.radiosOn === 'object') {
      change.radiosOn = {
        wifiOn: boolOrNull(v.radiosOn.wifiOn),
        dataOn: boolOrNull(v.radiosOn.dataOn),
      };
    }
    if (v.proxy && typeof v.proxy.set === 'string') {
      change.proxy = {
        set: v.proxy.set,
        previous: typeof v.proxy.previous === 'string' ? v.proxy.previous : null,
        ...reversePortsOf(v.proxy),
      };
    }
    const shape = v.emulatorShape;
    if (shape && typeof shape === 'object') {
      const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);
      const [up, down, min, max] = [
        shape.upKbps,
        shape.downKbps,
        shape.minLatencyMs,
        shape.maxLatencyMs,
      ].map(n);
      if (up !== null && down !== null && min !== null && max !== null) {
        change.emulatorShape = { upKbps: up, downKbps: down, minLatencyMs: min, maxLatencyMs: max };
      }
    }
    return change.offline || change.radiosOn || change.proxy || change.emulatorShape
      ? change
      : null;
  } catch {
    return null;
  }
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
