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

export type PhoneNetworkPart = 'offline' | 'proxy' | 'emulatorShape';

const PREFIX = 'phone-network:';

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
 * row per session, `phone-network:<sessionId>`, holding the JSON above.
 *
 * A failed write is logged and never fails a session: the change is still
 * made, and undone when the session ends; only a crash before then would
 * leave it.
 */
@Service()
export class PhoneNetworkLedger {
  private readonly logger = log.scope('PhoneNetwork');
  private readonly lock = new AsyncLock();

  /** Adds `part` to the session's record, creating the record if needed. */
  async note(
    sessionId: string,
    udid: string,
    part:
      | Pick<PhoneNetworkChange, 'offline'>
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
        if (next.offline || next.proxy || next.emulatorShape) await this.write(next);
        else await this.remove(sessionId);
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

  /** Every record, oldest first. A row that isn't a record is dropped. */
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
      const change = parseChange(row.value);
      if (change) out.push(change);
      else await this.remove(row.name.slice(PREFIX.length)).catch(() => undefined);
    }
    return out.sort((a, b) => a.at - b.at);
  }

  private async read(sessionId: string): Promise<PhoneNetworkChange | null> {
    const row = await prisma.webConfig.findUnique({ where: { name: PREFIX + sessionId } });
    return row ? parseChange(row.value) : null;
  }

  private async write(change: PhoneNetworkChange): Promise<void> {
    const name = PREFIX + change.sessionId;
    const value = JSON.stringify(change);
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

function parseChange(value: string): PhoneNetworkChange | null {
  try {
    const v = JSON.parse(value);
    if (!v || typeof v.sessionId !== 'string' || typeof v.udid !== 'string') return null;
    if (typeof v.at !== 'number') return null;
    const change: PhoneNetworkChange = { sessionId: v.sessionId, udid: v.udid, at: v.at };
    if (v.offline && typeof v.offline === 'object') {
      change.offline = {
        wifiOn: boolOrNull(v.offline.wifiOn),
        dataOn: boolOrNull(v.offline.dataOn),
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
    return change.offline || change.proxy || change.emulatorShape ? change : null;
  } catch {
    return null;
  }
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
