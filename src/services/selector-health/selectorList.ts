import type { Prisma, SelectorState } from '../../generated/client';
import { prisma } from '../../prisma';
import { visibleKeys } from './access';
import { DAY_MS } from './healingTrend';
import { peopleById } from './people';
import { SelectorKey, SessionScope, chunk, keyOf, sessionScope, tupleWhere } from './selectorKeys';
import { LatestEvents, StateView, latestEvents, stateView } from './stateView';

export const TABS = ['fix', 'verifying', 'fixed', 'muted'] as const;
export type SelectorTab = (typeof TABS)[number];
export const SORTS = ['heals', 'recent', 'time'] as const;
export type SelectorSort = (typeof SORTS)[number];

type StatusTab = Exclude<SelectorTab, 'fix'>;

/** Statuses that take a selector off "To fix". */
const OTHER_STATUSES = ['pending', 'resolved', 'muted'];

export interface SelectorListQuery {
  tab: SelectorTab;
  days: number;
  q: string;
  platform: string | null;
  method: string | null;
  sort: SelectorSort;
  page: number;
  pageSize: number;
}

function pick<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

function whole(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return fallback;
  return Math.min(Math.max(Number(raw), min), max);
}

function text(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

export function parseSelectorListQuery(q: Record<string, unknown>): SelectorListQuery {
  return {
    tab: pick(q.tab, TABS, 'fix'),
    days: whole(q.days, 30, 1, 365),
    q: text(q.q, 200),
    platform: text(q.platform, 40) || null,
    method: text(q.method, 40) || null,
    sort: pick(q.sort, SORTS, 'heals'),
    page: whole(q.page, 1, 1, 100_000),
    pageSize: whole(q.pageSize, 50, 1, 100),
  };
}

export interface SelectorListItem {
  strategy: string;
  selector: string;
  heals: number;
  sessions: number;
  lastHealedAt: string | null;
  timeSpentMs: number;
  topMethod: string | null;
  suggestion: { selector: string; strategy: string | null; share: number } | null;
  state: StateView | null;
}

export interface SelectorListAnswer {
  tab: SelectorTab;
  days: number;
  page: number;
  pageSize: number;
  total: number;
  counts: Record<SelectorTab, number>;
  items: SelectorListItem[];
}

interface HealGroup extends SelectorKey {
  key: string;
  heals: number;
  lastHealedAt: Date | null;
  timeSpentMs: number;
}

interface PageExtras {
  sessions: number;
  topMethod: string | null;
  suggestion: { selector: string; strategy: string | null; count: number } | null;
}

/** Heals in the period, in the caller's sessions, on a platform and by a method if given. */
function healWhere(
  since: Date,
  scope: SessionScope,
  platform: string | null,
  method: string | null,
): Prisma.SessionLogWhereInput {
  return {
    AND: [
      { is_healed: true, createdAt: { gte: since }, original_selector: { not: null } },
      method ? { healing_tier: method } : {},
      sessionScope(scope, platform),
    ],
  };
}

const forKeys = (
  where: Prisma.SessionLogWhereInput,
  keys: SelectorKey[],
): Prisma.SessionLogWhereInput => ({
  AND: [where, { OR: keys.map((k) => tupleWhere(k.strategy, k.selector)) }],
});

/** Heals, latest heal and time spent per selector, counted by the database: no heal is left out. */
async function healGroups(where: Prisma.SessionLogWhereInput): Promise<Map<string, HealGroup>> {
  const groups = await prisma.sessionLog.groupBy({
    by: ['original_strategy', 'original_selector'],
    where,
    _count: { _all: true },
    _max: { createdAt: true },
    _sum: { duration: true },
  });
  const out = new Map<string, HealGroup>();
  for (const g of groups) {
    const selector = g.original_selector;
    if (!selector) continue;
    const key = keyOf(g.original_strategy, selector);
    const prev = out.get(key);
    const last = g._max.createdAt ?? null;
    const prevLast = prev?.lastHealedAt ?? null;
    out.set(key, {
      key,
      strategy: g.original_strategy ?? '',
      selector,
      heals: (prev?.heals ?? 0) + g._count._all,
      lastHealedAt: prevLast && last ? (prevLast > last ? prevLast : last) : (prevLast ?? last),
      timeSpentMs: (prev?.timeSpentMs ?? 0) + (g._sum.duration ?? 0),
    });
  }
  return out;
}

/** The value counted most often; the first one seen on a tie. */
function topOf<T>(counts: Map<T, number>): T | null {
  let top: T | null = null;
  let best = -1;
  for (const [value, n] of counts) {
    if (n > best) {
      top = value;
      best = n;
    }
  }
  return top;
}

/** Sessions, top method and top suggestion, for one page's selectors only. */
async function pageExtras(
  where: Prisma.SessionLogWhereInput,
  keys: SelectorKey[],
): Promise<Map<string, PageExtras>> {
  const out = new Map<string, PageExtras>();
  if (keys.length === 0) return out;
  const scoped = forKeys(where, keys);
  const [bySession, byMethod, byFix] = await Promise.all([
    prisma.sessionLog.groupBy({
      by: ['original_strategy', 'original_selector', 'session_id'],
      where: scoped,
    }),
    prisma.sessionLog.groupBy({
      by: ['original_strategy', 'original_selector', 'healing_tier'],
      where: scoped,
      _count: { _all: true },
    }),
    prisma.sessionLog.groupBy({
      by: ['original_strategy', 'original_selector', 'healed_selector', 'healed_strategy'],
      where: { AND: [scoped, { healed_selector: { not: null } }] },
      _count: { _all: true },
    }),
  ]);
  const entry = (key: string): PageExtras => {
    let e = out.get(key);
    if (!e) {
      e = { sessions: 0, topMethod: null, suggestion: null };
      out.set(key, e);
    }
    return e;
  };
  for (const g of bySession)
    entry(keyOf(g.original_strategy, g.original_selector ?? '')).sessions += 1;

  const methods = new Map<string, Map<string, number>>();
  for (const g of byMethod) {
    if (!g.healing_tier) continue;
    const key = keyOf(g.original_strategy, g.original_selector ?? '');
    const m = methods.get(key) ?? new Map<string, number>();
    m.set(g.healing_tier, (m.get(g.healing_tier) ?? 0) + g._count._all);
    methods.set(key, m);
  }
  for (const [key, m] of methods) entry(key).topMethod = topOf(m);

  const fixes = new Map<string, Map<string, number>>();
  const fixOf = new Map<string, { selector: string; strategy: string | null }>();
  for (const g of byFix) {
    if (!g.healed_selector) continue;
    const key = keyOf(g.original_strategy, g.original_selector ?? '');
    const fixKey = keyOf(g.healed_strategy, g.healed_selector);
    fixOf.set(fixKey, { selector: g.healed_selector, strategy: g.healed_strategy ?? null });
    const m = fixes.get(key) ?? new Map<string, number>();
    m.set(fixKey, (m.get(fixKey) ?? 0) + g._count._all);
    fixes.set(key, m);
  }
  for (const [key, m] of fixes) {
    const top = topOf(m);
    const fix = top ? fixOf.get(top) : undefined;
    if (top && fix) entry(key).suggestion = { ...fix, count: m.get(top) ?? 0 };
  }
  return out;
}

/** Selectors whose suggested fix contains `needle` (lower case), compared here so `%` and `_` are plain text. */
async function keysWithFixMatching(
  where: Prisma.SessionLogWhereInput,
  needle: string,
): Promise<Set<string>> {
  const pairs = await prisma.sessionLog.groupBy({
    by: ['original_strategy', 'original_selector', 'healed_selector'],
    where: { AND: [where, { healed_selector: { not: null } }] },
  });
  const out = new Set<string>();
  for (const p of pairs) {
    if (p.original_selector && p.healed_selector?.toLowerCase().includes(needle)) {
      out.add(keyOf(p.original_strategy, p.original_selector));
    }
  }
  return out;
}

const time = (d: Date | null | undefined) => d?.getTime() ?? 0;
const byKey = (a: HealGroup, b: HealGroup) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const byLast = (a: HealGroup, b: HealGroup) => time(b.lastHealedAt) - time(a.lastHealedAt);

const SORTERS: Record<SelectorSort, (a: HealGroup, b: HealGroup) => number> = {
  heals: (a, b) => b.heals - a.heals || byLast(a, b) || byKey(a, b),
  recent: (a, b) => byLast(a, b) || b.heals - a.heals || byKey(a, b),
  time: (a, b) => b.timeSpentMs - a.timeSpentMs || b.heals - a.heals || byKey(a, b),
};

const STATUS_OF: Record<StatusTab, string> = {
  verifying: 'pending',
  fixed: 'resolved',
  muted: 'muted',
};

const NEWEST_FIRST: Record<StatusTab, (a: SelectorState, b: SelectorState) => number> = {
  verifying: (a, b) => time(b.fixed_at) - time(a.fixed_at),
  fixed: (a, b) => time(b.resolved_at) - time(a.resolved_at),
  muted: (a, b) => time(b.muted_at) - time(a.muted_at),
};

/** `page` of `all`, or its last page when `page` is past the end. */
function pageOf<T>(all: T[], page: number, size: number): { page: number; slice: T[] } {
  const last = Math.max(1, Math.ceil(all.length / size));
  const p = Math.min(page, last);
  return { page: p, slice: all.slice((p - 1) * size, p * size) };
}

const keyOfState = (s: SelectorState) => keyOf(s.original_strategy, s.original_selector);
const toKey = (s: SelectorState): SelectorKey => ({
  strategy: s.original_strategy,
  selector: s.original_selector,
});

async function stateRows(keys: SelectorKey[]): Promise<SelectorState[]> {
  const out: SelectorState[] = [];
  for (const part of chunk(keys)) {
    out.push(
      ...(await prisma.selectorState.findMany({
        where: {
          OR: part.map((k) => ({ original_strategy: k.strategy, original_selector: k.selector })),
        },
      })),
    );
  }
  return out;
}

async function stateViews(rows: SelectorState[]): Promise<Map<string, StateView>> {
  const latest = await latestEvents(rows.map(toKey));
  const people = await peopleById(
    Array.from(latest.values()).flatMap((l: LatestEvents) => [l.fixed?.user_id, l.muted?.user_id]),
  );
  const out = new Map<string, StateView>();
  for (const r of rows) {
    const view = stateView(r, latest.get(keyOfState(r)) ?? {}, people);
    if (view) out.set(keyOfState(r), view);
  }
  return out;
}

function item(
  k: SelectorKey,
  g: HealGroup | undefined,
  extras: PageExtras | undefined,
  state: StateView | null,
): SelectorListItem {
  const heals = g?.heals ?? 0;
  const s = extras?.suggestion;
  return {
    strategy: k.strategy,
    selector: k.selector,
    heals,
    sessions: extras?.sessions ?? 0,
    lastHealedAt: g?.lastHealedAt ? g.lastHealedAt.toISOString() : null,
    timeSpentMs: g?.timeSpentMs ?? 0,
    topMethod: extras?.topMethod ?? null,
    suggestion:
      s && heals > 0
        ? { selector: s.selector, strategy: s.strategy, share: s.count / heals }
        : null,
    state,
  };
}

/**
 * One tab of the list. "To fix" groups the period's heals by selector and
 * leaves out those with another status; the other tabs start from the
 * selectors with their status. Only selectors the caller may see.
 */
export async function listSelectors(
  query: SelectorListQuery,
  scope: SessionScope,
  now = new Date(),
): Promise<SelectorListAnswer> {
  const since = new Date(now.getTime() - query.days * DAY_MS);
  const states = await prisma.selectorState.findMany({ where: { status: { in: OTHER_STATUSES } } });
  const visible = await visibleKeys(states.map(toKey), scope);
  const seen = states.filter((s) => visible.has(keyOfState(s)));
  const inTab: Record<StatusTab, SelectorState[]> = {
    verifying: seen.filter((s) => s.status === STATUS_OF.verifying),
    fixed: seen.filter(
      (s) => s.status === STATUS_OF.fixed && !!s.resolved_at && s.resolved_at >= since,
    ),
    muted: seen.filter((s) => s.status === STATUS_OF.muted),
  };
  const notToFix = new Set(states.map(keyOfState));
  const allHeals = healWhere(since, scope, null, null);
  const base = await healGroups(allHeals);
  const counts: Record<SelectorTab, number> = {
    fix: Array.from(base.keys()).filter((k) => !notToFix.has(k)).length,
    verifying: inTab.verifying.length,
    fixed: inTab.fixed.length,
    muted: inTab.muted.length,
  };
  const answer = (total: number, page: number, items: SelectorListItem[]): SelectorListAnswer => ({
    tab: query.tab,
    days: query.days,
    page,
    pageSize: query.pageSize,
    total,
    counts,
    items,
  });
  const needle = query.q.toLowerCase();

  if (query.tab === 'fix') {
    const filtered = !!(query.platform || query.method);
    const where = filtered ? healWhere(since, scope, query.platform, query.method) : allHeals;
    const groups = filtered ? await healGroups(where) : base;
    let candidates = Array.from(groups.values()).filter((g) => !notToFix.has(g.key));
    if (needle) {
      const viaFix = await keysWithFixMatching(where, needle);
      candidates = candidates.filter(
        (g) => g.selector.toLowerCase().includes(needle) || viaFix.has(g.key),
      );
    }
    candidates.sort(SORTERS[query.sort]);
    const { page, slice } = pageOf(candidates, query.page, query.pageSize);
    const [extras, rows] = await Promise.all([pageExtras(where, slice), stateRows(slice)]);
    const views = await stateViews(rows);
    return answer(
      candidates.length,
      page,
      slice.map((g) => item(g, g, extras.get(g.key), views.get(g.key) ?? null)),
    );
  }

  let rows = inTab[query.tab];
  if (needle) rows = rows.filter((s) => s.original_selector.toLowerCase().includes(needle));
  rows = rows.slice().sort(NEWEST_FIRST[query.tab]);
  const { page, slice } = pageOf(rows, query.page, query.pageSize);
  const keys = slice.map(toKey);
  const [groups, extras, views] = await Promise.all([
    keys.length > 0
      ? healGroups(forKeys(allHeals, keys))
      : Promise.resolve(new Map<string, HealGroup>()),
    pageExtras(allHeals, keys),
    stateViews(slice),
  ]);
  return answer(
    rows.length,
    page,
    keys.map((k) => {
      const key = keyOf(k.strategy, k.selector);
      return item(k, groups.get(key), extras.get(key), views.get(key) ?? null);
    }),
  );
}
