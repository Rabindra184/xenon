import { prisma } from '../../prisma';
import { canSeeSelector } from './access';
import { DAY_MS, dailyHeals, parseTzOffset } from './healingTrend';
import { Person, peopleById } from './people';
import { SessionScope, sessionScope, tupleWhere } from './selectorKeys';
import { StateView, stateView } from './stateView';

export interface SelectorDetailQuery {
  strategy: string;
  selector: string;
  days: number;
  tz: number;
}

/** A selector longer than this is no selector anyone wrote. */
const MAX_SELECTOR = 4000;

export function parseSelectorDetailQuery(q: Record<string, unknown>): SelectorDetailQuery | null {
  const selector = typeof q.selector === 'string' ? q.selector : '';
  if (!selector || selector.length > MAX_SELECTOR) return null;
  const strategy = typeof q.strategy === 'string' ? q.strategy.slice(0, 200) : '';
  const days =
    typeof q.days === 'string' && /^\d+$/.test(q.days)
      ? Math.min(Math.max(Number(q.days), 1), 365)
      : 30;
  return { strategy, selector, days, tz: parseTzOffset(q.tz) };
}

export interface SelectorDetail {
  strategy: string;
  selector: string;
  days: number;
  heals: number;
  sessions: number;
  timeSpentMs: number;
  firstHealedAt: string | null;
  lastHealedAt: string | null;
  daily: Array<{ t: number; heals: number }>;
  suggestions: Array<{
    selector: string;
    strategy: string | null;
    count: number;
    share: number;
    methods: string[];
    averageConfidence: number | null;
  }>;
  platforms: Array<{ name: string; count: number }>;
  builds: Array<{ id: string | null; name: string; count: number }>;
  devices: Array<{ udid: string; name: string; count: number }>;
  recent: Array<{
    id: string;
    sessionId: string;
    buildId: string | null;
    at: string;
    device: string | null;
    platform: string | null;
    method: string | null;
    confidence: number | null;
    healedSelector: string | null;
  }>;
  state: StateView | null;
  activity: Array<{ action: string; at: string; by: Person | null; reason: string | null }>;
}

const TOP = 5;
const RECENT = 20;
const ACTIVITY = 50;

interface FixTally {
  selector: string;
  strategy: string | null;
  count: number;
  methods: Set<string>;
  confidenceSum: number;
  confidenceCount: number;
}

function bump<T extends { count: number }>(m: Map<string, T>, key: string, make: () => T): void {
  const v = m.get(key) ?? make();
  v.count += 1;
  m.set(key, v);
}

const topCounts = <T extends { count: number }>(m: Map<string, T>): T[] =>
  Array.from(m.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP);

/**
 * Everything the panel shows for one selector over the period, or null when
 * the caller may not see it (a member, and no session they can see healed
 * it). Status and activity are lab-wide: one row per selector.
 */
export async function selectorDetail(
  query: SelectorDetailQuery,
  scope: SessionScope,
  now = new Date(),
): Promise<SelectorDetail | null> {
  if (!(await canSeeSelector({ strategy: query.strategy, selector: query.selector }, scope))) {
    return null;
  }
  const since = new Date(now.getTime() - query.days * DAY_MS);
  const rows = await prisma.sessionLog.findMany({
    where: {
      AND: [
        { is_healed: true, createdAt: { gte: since } },
        tupleWhere(query.strategy, query.selector),
        sessionScope(scope),
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      session_id: true,
      createdAt: true,
      healed_selector: true,
      healed_strategy: true,
      healing_tier: true,
      healing_confidence: true,
      duration: true,
      session: {
        select: {
          build_id: true,
          device_udid: true,
          device_name: true,
          device_platform: true,
          build: { select: { name: true } },
        },
      },
    },
  });

  const sessions = new Set<string>();
  let timeSpentMs = 0;
  const fixes = new Map<string, FixTally>();
  const platforms = new Map<string, { name: string; count: number }>();
  const builds = new Map<string, { id: string | null; name: string; count: number }>();
  const devices = new Map<string, { udid: string; name: string; count: number }>();
  for (const r of rows) {
    sessions.add(r.session_id);
    timeSpentMs += r.duration ?? 0;
    if (r.healed_selector) {
      const fixKey = `${r.healed_strategy ?? ''}\u0000${r.healed_selector}`;
      const f: FixTally = fixes.get(fixKey) ?? {
        selector: r.healed_selector,
        strategy: r.healed_strategy ?? null,
        count: 0,
        methods: new Set<string>(),
        confidenceSum: 0,
        confidenceCount: 0,
      };
      f.count += 1;
      if (r.healing_tier) f.methods.add(r.healing_tier);
      if (typeof r.healing_confidence === 'number') {
        f.confidenceSum += r.healing_confidence;
        f.confidenceCount += 1;
      }
      fixes.set(fixKey, f);
    }
    const platform = r.session.device_platform || 'unknown';
    bump(platforms, platform, () => ({ name: platform, count: 0 }));
    const buildId = r.session.build_id ?? null;
    bump(builds, buildId ?? '', () => ({
      id: buildId,
      name: r.session.build?.name || buildId || 'No build',
      count: 0,
    }));
    const udid = r.session.device_udid;
    if (udid) bump(devices, udid, () => ({ udid, name: r.session.device_name || udid, count: 0 }));
  }

  const [state, events] = await Promise.all([
    prisma.selectorState.findUnique({
      where: {
        original_strategy_original_selector: {
          original_strategy: query.strategy,
          original_selector: query.selector,
        },
      },
    }),
    prisma.selectorEvent.findMany({
      where: { original_strategy: query.strategy, original_selector: query.selector },
      orderBy: { createdAt: 'desc' },
      take: ACTIVITY,
    }),
  ]);
  const people = await peopleById(events.map((e) => e.user_id));
  const fixedEvent = events.find((e) => e.action === 'marked_fixed');
  const mutedEvent = events.find((e) => e.action === 'muted');

  return {
    strategy: query.strategy,
    selector: query.selector,
    days: query.days,
    heals: rows.length,
    sessions: sessions.size,
    timeSpentMs,
    firstHealedAt: rows.length > 0 ? rows[rows.length - 1].createdAt.toISOString() : null,
    lastHealedAt: rows.length > 0 ? rows[0].createdAt.toISOString() : null,
    daily: dailyHeals(
      rows.map((r) => ({ at: r.createdAt, method: r.healing_tier })),
      since,
      now,
      query.tz,
    ).map((d) => ({ t: d.t, heals: d.heals })),
    suggestions: Array.from(fixes.values())
      .sort((a, b) => b.count - a.count)
      .map((f) => ({
        selector: f.selector,
        strategy: f.strategy,
        count: f.count,
        share: rows.length > 0 ? f.count / rows.length : 0,
        methods: Array.from(f.methods),
        averageConfidence: f.confidenceCount > 0 ? f.confidenceSum / f.confidenceCount : null,
      })),
    platforms: topCounts(platforms),
    builds: topCounts(builds),
    devices: topCounts(devices),
    recent: rows.slice(0, RECENT).map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      buildId: r.session.build_id ?? null,
      at: r.createdAt.toISOString(),
      device: r.session.device_name || r.session.device_udid || null,
      platform: r.session.device_platform || null,
      method: r.healing_tier ?? null,
      confidence: r.healing_confidence ?? null,
      healedSelector: r.healed_selector ?? null,
    })),
    state: stateView(
      state,
      {
        fixed: fixedEvent ? { user_id: fixedEvent.user_id } : undefined,
        muted: mutedEvent ? { user_id: mutedEvent.user_id, reason: mutedEvent.reason } : undefined,
      },
      people,
    ),
    activity: events.map((e) => ({
      action: e.action,
      at: e.createdAt.toISOString(),
      by: e.user_id ? (people.get(e.user_id) ?? { id: e.user_id, name: null }) : null,
      reason: e.reason ?? null,
    })),
  };
}
