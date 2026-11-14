import type { SelectorState } from '../../generated/client';
import { prisma } from '../../prisma';
import { Person } from './people';
import { SelectorKey, chunk, keyOf } from './selectorKeys';
import { SelectorStatus, carriesFix } from './selectorStatus';

/** A selector's status as the dashboard shows it. */
export interface StateView {
  status: SelectorStatus;
  cleanBuilds: number;
  fixedAt: string | null;
  fixedBy: Person | null;
  resolvedAt: string | null;
  mutedAt: string | null;
  mutedBy: Person | null;
  muteReason: string | null;
  /** How often it healed again after being fixed. */
  brokeAgain: number;
}

/** The latest "marked fixed" and "muted" events of one selector. */
export interface LatestEvents {
  fixed?: { user_id: string | null };
  muted?: { user_id: string | null; reason: string | null };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function stateView(
  row: SelectorState | null,
  latest: LatestEvents,
  people: Map<string, Person>,
): StateView | null {
  if (!row) return null;
  const person = (id: string | null | undefined): Person | null =>
    id ? (people.get(id) ?? { id, name: null }) : null;
  const muted = row.status === 'muted';
  // Only a selector being verified or fixed has a fix to show. Rows written
  // through 2.36 could be `active` or `muted` with the fix they had before,
  // which showed as "fixed by" someone.
  const fix = carriesFix(row.status);
  return {
    status: row.status as SelectorStatus,
    cleanBuilds: fix ? row.clean_builds_count : 0,
    fixedAt: fix ? iso(row.fixed_at) : null,
    fixedBy: fix && row.fixed_at ? person(latest.fixed?.user_id) : null,
    resolvedAt: fix ? iso(row.resolved_at) : null,
    mutedAt: iso(row.muted_at),
    mutedBy: muted ? person(latest.muted?.user_id) : null,
    muteReason: muted ? (latest.muted?.reason ?? null) : null,
    brokeAgain: row.regression_count,
  };
}

/** The latest "marked fixed" and "muted" events of each selector, by key. */
export async function latestEvents(keys: SelectorKey[]): Promise<Map<string, LatestEvents>> {
  const out = new Map<string, LatestEvents>();
  for (const part of chunk(keys)) {
    const events = await prisma.selectorEvent.findMany({
      where: {
        action: { in: ['marked_fixed', 'muted'] },
        OR: part.map((k) => ({ original_strategy: k.strategy, original_selector: k.selector })),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        original_strategy: true,
        original_selector: true,
        action: true,
        user_id: true,
        reason: true,
      },
    });
    for (const e of events) {
      const key = keyOf(e.original_strategy, e.original_selector);
      const cur = out.get(key) ?? {};
      if (e.action === 'marked_fixed' && !cur.fixed) cur.fixed = { user_id: e.user_id };
      if (e.action === 'muted' && !cur.muted) cur.muted = { user_id: e.user_id, reason: e.reason };
      out.set(key, cur);
    }
  }
  return out;
}
