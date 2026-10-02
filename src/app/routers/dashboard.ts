import { Request, Response, Router, NextFunction } from 'express';
import { prisma } from '../../prisma';
import { SESSION_MANAGER } from '../../sessions/SessionManager';
import { UniversalMjpegProxy, shouldRecreateMjpegProxy } from '../../helpers/UniversalMjpegProxy';
import { WebConfigService } from '../../data-service/web-config-service';
import { Container } from 'typedi';
import { scopeGuard } from '../../middleware/scopeGuard';
import { roleGuard } from '../../middleware/roleGuard';
import buildExportModule from './build-export';
import { NotificationService } from '../../services/NotificationService';
import {
  SelectorStateService,
  SelectorStateConflictError,
} from '../../services/SelectorStateService';
import path from 'path';
import { config } from '../../config';
import {
  canSeeSession,
  SessionCaller,
  visibleSessionWhere,
} from '../../services/device-access/sessionVisibility';
import { HealEtalonService } from '../../services/healing/HealEtalonService';
import { sessionMetricsBody } from '../../services/metrics/metricsBody';
import { SessionMetricsService } from '../../services/metrics/SessionMetricsService';
import {
  cursorWhere,
  describeSessions,
  InvalidQueryError,
  parseIds,
  parseLimit,
  parseSince,
  sessionOutcome,
  summarizeSessions,
} from './sessionInsights';
import log from '../../logger';

const MJPEG_PROXY_CACHE: Map<string, any> = new Map();

const authOf = (request: Request) => (request as Request & { auth?: SessionCaller }).auth;

/**
 * Only the healed logs of sessions the caller may see (visibleSessionWhere),
 * as a SessionLog `where` fragment; empty for an admin.
 */
async function visibleLogScope(request: Request) {
  const where = await visibleSessionWhere(authOf(request));
  return where ? { session: { is: where } } : {};
}

// Session guard, on every /session/:sessionId route: the session must exist
// and be one the caller may see (canSeeSession). Another team's session gets
// exactly the unknown-id answer, so it can't be told apart from none.
async function isValidSession(request: Request, response: Response, next: NextFunction) {
  const sessionId = request.params.sessionId;

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
    },
  });
  if (!session || !(await canSeeSession(session, authOf(request)))) {
    return response.status(404).send({
      error: true,
      message: `Session with id ${sessionId} not found`,
    });
  } else {
    return next();
  }
}

// A query parameter that can't be read is refused, rather than ignored into
// a list of every session. Undefined when it was refused.
function readQuery<T>(response: Response, read: () => T): T | undefined {
  try {
    return read();
  } catch (err) {
    if (!(err instanceof InvalidQueryError)) throw err;
    response.status(400).json({ error: err.code, message: err.message });
    return undefined;
  }
}

function sinceOf(request: Request, response: Response): Date | null | undefined {
  return readQuery(response, () => parseSince(request.query.since));
}

async function getSessions(request: Request, response: Response) {
  const { buildId, query, status, platform } = request.query;
  const since = sinceOf(request, response);
  if (since === undefined) return;
  const limit = readQuery(response, () => parseLimit(request.query.limit));
  if (limit === undefined) return;
  const cursor = readQuery(response, () =>
    cursorWhere(request.query.before, request.query.beforeId),
  );
  if (cursor === undefined) return;
  const ids = readQuery(response, () => parseIds(request.query.ids));
  if (ids === undefined) return;

  const where: any = {};

  if (ids) {
    where.id = { in: ids };
  }

  if (since) {
    where.createdAt = { gte: since };
  }

  if (buildId) {
    where.build_id = buildId as string;
  }

  if (status) {
    where.status = status as string;
  }

  if (platform) {
    where.device_platform = platform as string;
  }

  if (query) {
    where.OR = [
      { id: { contains: query as string } },
      { name: { contains: query as string } },
      { device_udid: { contains: query as string } },
      { device_name: { contains: query as string } },
      { failure_category: { contains: query as string } },
      { tags: { contains: query as string } },
    ];
  }

  // The team rule is part of the query, so `take` counts the caller's sessions.
  const visible = await visibleSessionWhere(authOf(request));
  const and = [where, ...(cursor ? [cursor] : []), ...(visible ? [visible] : [])];
  const sessions = await prisma.session.findMany({
    // Newest first; the id orders rows created in the same millisecond, so a
    // page's cursor (its last row) continues exactly where it stopped.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    where: and.length === 1 ? where : { AND: and },
    take: limit,
  });
  return response.status(200).json(await describeSessions(sessions));
}

// The Sessions page's summary strip: the period since `since` (all time
// without it) and the one before it, over the sessions the caller may see,
// of one build when `buildId` is given.
async function getSessionSummary(request: Request, response: Response) {
  const since = sinceOf(request, response);
  if (since === undefined) return;
  const { buildId } = request.query;
  const visible = await visibleSessionWhere(authOf(request));
  const scope: Record<string, unknown> = {
    AND: [
      ...(visible ? [visible] : []),
      ...(typeof buildId === 'string' && buildId ? [{ build_id: buildId }] : []),
    ],
  };
  return response.status(200).json(await summarizeSessions(scope, since));
}

async function getBuilds(request: Request, response: Response) {
  // A build is listed if the caller may see at least one of its sessions, and
  // its counts are over those sessions only: builds are shared by name, so
  // one build can hold several teams' sessions. Admins get every session.
  const visible = await visibleSessionWhere(authOf(request));
  const builds = await prisma.build.findMany({
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      sessions: {
        ...(visible ? { where: visible } : {}),
        select: {
          status: true,
          device_udid: true,
        },
      },
    },
  });
  const visibleBuilds = visible ? builds.filter((b) => b.sessions.length > 0) : builds;

  // Principal formatting: Add a flat summary object for the frontend
  const formattedBuilds = visibleBuilds.map((b) => ({
    ...b,
    _count: { sessions: b.sessions.length },
    sessionCount: b.sessions.length,
    passedCount: b.sessions.filter((s) => sessionOutcome(s.status) === 'passed').length,
    failedCount: b.sessions.filter((s) => sessionOutcome(s.status) === 'failed').length,
    runningCount: b.sessions.filter((s) => sessionOutcome(s.status) === 'running').length,
    sessions: undefined, // remove raw sessions for payload efficiency
  }));

  return response.status(200).json(formattedBuilds);
}

async function getSessionById(request: Request, response: Response) {
  const sessionId = request.params.sessionId;
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });
  // isValidSession has already refused an unknown or hidden session.
  if (!session) {
    return response.status(404).json({ error: true, message: 'Session not found' });
  }
  // Who ran it and where, as the list says (describeSessions).
  const [described] = await describeSessions([session]);
  return response.status(200).json(described);
}

async function getSessionLogs(request: Request, response: Response) {
  const sessionId = request.params.sessionId;

  const logs = await prisma.sessionLog.findMany({
    orderBy: {
      createdAt: 'desc',
    },
    where: {
      session_id: sessionId,
    },
  });
  return response.status(200).json(logs);
}

async function getDeviceLogs(request: Request, response: Response) {
  const sessionId = request.params.sessionId;

  const logs = await prisma.log.findMany({
    orderBy: {
      createdAt: 'asc',
    },
    where: {
      session_id: sessionId,
      log_type: 'DEVICE',
    },
  });
  return response.status(200).json(logs);
}

async function getDebugLogs(request: Request, response: Response) {
  const sessionId = request.params.sessionId;

  const logs = await prisma.log.findMany({
    orderBy: {
      createdAt: 'asc',
    },
    where: {
      session_id: sessionId,
      log_type: 'DEBUG',
    },
  });
  return response.status(200).json(logs);
}

function startOfTodayUtc(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getRecentHealingEvents(request: Request, response: Response) {
  const limitRaw = parseInt((request.query.limit as string) || '50', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const sessionId = (request.query.sessionId as string) || undefined;

  // Another team's session, even by ?sessionId=, reads as one with no heals.
  const scope = await visibleLogScope(request);
  const [rows, todayCount] = await Promise.all([
    prisma.sessionLog.findMany({
      where: { is_healed: true, ...(sessionId ? { session_id: sessionId } : {}), ...scope },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        session: {
          select: {
            id: true,
            device_udid: true,
            device_name: true,
            device_platform: true,
          },
        },
      },
    }),
    prisma.sessionLog.count({
      where: { is_healed: true, createdAt: { gte: startOfTodayUtc() }, ...scope },
    }),
  ]);

  const events = rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    deviceUdid: r.session?.device_udid ?? null,
    deviceName: r.session?.device_name ?? null,
    devicePlatform: r.session?.device_platform ?? null,
    commandName: r.command_name ?? null,
    originalSelector: r.original_selector ?? null,
    healedSelector: r.healed_selector ?? null,
    confidence: r.healing_confidence ?? null,
    tier: r.healing_tier ?? null,
    isSuccess: r.is_success ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  return response.status(200).json({ events, todayCount });
}

function parseWindowDays(raw: unknown, fallback = 30): number {
  const n = parseInt(typeof raw === 'string' ? raw : '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), 365);
}

// Selector Health summary: KPI strip data with prior-period comparison
// so the page can show "are we getting healthier?" deltas.
async function getHealingSummary(request: Request, response: Response) {
  const windowDays = parseWindowDays(request.query.windowDays);
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - windowDays);
  const priorSince = new Date(since);
  priorSince.setDate(priorSince.getDate() - windowDays);

  // Heal counts are over the caller's sessions. resolvedCount and pendingCount
  // come from SelectorState, which has no team, so they stay fleet-wide.
  const scope = await visibleLogScope(request);
  const [currentRows, priorRows] = await Promise.all([
    prisma.sessionLog.findMany({
      where: {
        is_healed: true,
        createdAt: { gte: since, lte: now },
        original_selector: { not: null },
        ...scope,
      },
      select: {
        session_id: true,
        original_selector: true,
        healing_tier: true,
      },
    }),
    prisma.sessionLog.findMany({
      where: {
        is_healed: true,
        createdAt: { gte: priorSince, lt: since },
        original_selector: { not: null },
        ...scope,
      },
      select: {
        session_id: true,
        original_selector: true,
        healing_tier: true,
      },
    }),
  ]);

  const aggregate = (rows: typeof currentRows) => {
    const sessions = new Set<string>();
    const selectors = new Set<string>();
    const byTier: Record<string, number> = {};
    for (const r of rows) {
      sessions.add(r.session_id);
      if (r.original_selector) selectors.add(r.original_selector);
      const tier = r.healing_tier || 'Unknown';
      byTier[tier] = (byTier[tier] || 0) + 1;
    }
    return {
      totalHeals: rows.length,
      distinctSelectors: selectors.size,
      sessionsTouched: sessions.size,
      byTier,
    };
  };

  const current = aggregate(currentRows);
  const prior = aggregate(priorRows);

  // Lifecycle counts: how many selectors have been resolved in this
  // window, and how many are mid-verification right now. Cheap — both
  // are indexed COUNT(*)s.
  const [resolvedCount, pendingCount] = await Promise.all([
    prisma.selectorState.count({
      where: { status: 'resolved', resolved_at: { gte: since } },
    }),
    prisma.selectorState.count({ where: { status: 'pending' } }),
  ]);

  return response.status(200).json({
    windowDays,
    current,
    prior,
    resolvedCount,
    pendingCount,
  });
}

async function getHealingHotspots(request: Request, response: Response) {
  const windowDays = parseWindowDays(request.query.windowDays);
  const limitRaw = parseInt((request.query.limit as string) || '20', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
  const tier =
    typeof request.query.tier === 'string' && request.query.tier ? request.query.tier : null;
  const platform =
    typeof request.query.platform === 'string' && request.query.platform
      ? request.query.platform
      : null;
  const status = (request.query.status as string | undefined) ?? 'active';

  const agg = await aggregateHotspots({
    windowDays,
    limit,
    tier,
    platform,
    status,
    sessionWhere: await visibleSessionWhere(authOf(request)),
  });

  return response.status(200).json({
    windowDays,
    totalScanned: agg.totalScanned,
    filters: { tier, platform, status },
    hotspots: agg.hotspots,
  });
}

// Decide whether a hotspot, augmented with its (optional) SelectorState row,
// belongs in the response for a given `?status=` query value.
//
// `active` (default) hides muted/pending/resolved selectors, so that fixes,
// triage, and silenced selectors stop polluting the live hotspot list. The
// CI gate and webhook digest both inherit this default — that's intentional
// (spec §10.3).
function filterByStatus(state: any, requested: string): boolean {
  switch (requested) {
    case 'all':
      return true;
    case 'pending':
      return state?.status === 'pending';
    case 'resolved':
      return state?.status === 'resolved';
    case 'muted':
      return state?.status === 'muted';
    case 'active':
    default:
      return state == null || state.status === 'active';
  }
}

// Shape used by both the dashboard hotspots view and the CI gate. Kept
// close to the route to keep type churn local.
interface HotspotRow {
  originalStrategy: string | null;
  originalSelector: string;
  healCount: number;
  sessionCount: number;
  topTier: string | null;
  suggestedRewrite: string | null;
  suggestedStrategy: string | null;
  suggestedRewriteShare: number | null;
  averageConfidence: number | null;
  firstHealedAt: string;
  lastHealedAt: string;
  state?: any | null;
}

interface HotspotAggregation {
  totalScanned: number;
  totalHeals: number;
  distinctSelectors: number;
  sessionsTouched: number;
  byTier: Record<string, number>;
  hotspots: HotspotRow[];
}

interface HotspotQueryOptions {
  windowDays: number;
  limit: number;
  tier?: string | null;
  platform?: string | null;
  buildId?: string | null;
  minHealCount?: number;
  status?: string;
  /**
   * Count only heals from sessions matching this Session `where`: the
   * caller's visibleSessionWhere. Combined with the platform and build filter
   * under `AND`. Omitted means every session: an admin, or the digest.
   */
  sessionWhere?: Record<string, unknown>;
}

export async function aggregateHotspots(
  opts: HotspotQueryOptions,
): Promise<HotspotAggregation> {
  const since = new Date();
  since.setDate(since.getDate() - opts.windowDays);

  const where: any = {
    is_healed: true,
    createdAt: { gte: since },
    original_selector: { not: null },
  };
  if (opts.tier) where.healing_tier = opts.tier;
  // The platform and build filter, and the caller's sessions, under AND: the
  // caller's rule is an OR, and a spread would let one OR overwrite another.
  const sessionFilters: Array<Record<string, unknown>> = [];
  if (opts.platform || opts.buildId) {
    sessionFilters.push({
      ...(opts.platform ? { device_platform: opts.platform } : {}),
      ...(opts.buildId ? { build_id: opts.buildId } : {}),
    });
  }
  if (opts.sessionWhere) sessionFilters.push(opts.sessionWhere);
  if (sessionFilters.length === 1) where.session = sessionFilters[0];
  else if (sessionFilters.length > 1) where.session = { AND: sessionFilters };

  const rows = await prisma.sessionLog.findMany({
    where,
    select: {
      session_id: true,
      original_strategy: true,
      original_selector: true,
      healed_strategy: true,
      healed_selector: true,
      healing_confidence: true,
      healing_tier: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });

  type Bucket = {
    originalStrategy: string | null;
    originalSelector: string;
    healCount: number;
    sessions: Set<string>;
    tiers: Map<string, number>;
    healedSelectors: Map<string, number>;
    healedStrategies: Map<string, number>;
    confidenceSum: number;
    confidenceSamples: number;
    lastHealedAt: Date;
    firstHealedAt: Date;
  };

  const buckets = new Map<string, Bucket>();
  const byTier: Record<string, number> = {};
  const sessionsTouched = new Set<string>();
  for (const r of rows) {
    sessionsTouched.add(r.session_id);
    const tier = r.healing_tier || 'Unknown';
    byTier[tier] = (byTier[tier] || 0) + 1;

    // Group by (strategy, selector) tuple. Two heals with the same selector
    // value but different strategies are genuinely different problems and
    // get separate hotspot rows.
    const key = `${r.original_strategy ?? ''}\x00${r.original_selector!}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        originalStrategy: r.original_strategy ?? null,
        originalSelector: r.original_selector!,
        healCount: 0,
        sessions: new Set<string>(),
        tiers: new Map<string, number>(),
        healedSelectors: new Map<string, number>(),
        healedStrategies: new Map<string, number>(),
        confidenceSum: 0,
        confidenceSamples: 0,
        lastHealedAt: r.createdAt,
        firstHealedAt: r.createdAt,
      };
      buckets.set(key, b);
    }
    b.healCount += 1;
    b.sessions.add(r.session_id);
    if (r.healing_tier) b.tiers.set(r.healing_tier, (b.tiers.get(r.healing_tier) ?? 0) + 1);
    if (r.healed_selector) {
      b.healedSelectors.set(
        r.healed_selector,
        (b.healedSelectors.get(r.healed_selector) ?? 0) + 1,
      );
    }
    if (r.healed_strategy) {
      b.healedStrategies.set(
        r.healed_strategy,
        (b.healedStrategies.get(r.healed_strategy) ?? 0) + 1,
      );
    }
    if (typeof r.healing_confidence === 'number') {
      b.confidenceSum += r.healing_confidence;
      b.confidenceSamples += 1;
    }
    if (r.createdAt > b.lastHealedAt) b.lastHealedAt = r.createdAt;
    if (r.createdAt < b.firstHealedAt) b.firstHealedAt = r.createdAt;
  }

  const pickTopEntry = <T>(m: Map<T, number>): { value: T; count: number } | null => {
    let top: { value: T; count: number } | null = null;
    for (const [value, count] of m) {
      if (!top || count > top.count) top = { value, count };
    }
    return top;
  };

  const minCount = opts.minHealCount ?? 1;
  const topHotspots: HotspotRow[] = Array.from(buckets.values())
    .filter((b) => b.healCount >= minCount)
    .sort(
      (a, b) =>
        b.healCount - a.healCount || b.lastHealedAt.getTime() - a.lastHealedAt.getTime(),
    )
    .slice(0, opts.limit)
    .map((b) => {
      const topRewrite = pickTopEntry(b.healedSelectors);
      const topTier = pickTopEntry(b.tiers);
      const topStrategy = pickTopEntry(b.healedStrategies);
      return {
        originalStrategy: b.originalStrategy,
        originalSelector: b.originalSelector,
        healCount: b.healCount,
        sessionCount: b.sessions.size,
        topTier: topTier?.value ?? null,
        suggestedRewrite: topRewrite?.value ?? null,
        suggestedStrategy: topStrategy?.value ?? null,
        suggestedRewriteShare: topRewrite ? topRewrite.count / b.healCount : null,
        averageConfidence:
          b.confidenceSamples > 0 ? b.confidenceSum / b.confidenceSamples : null,
        firstHealedAt: b.firstHealedAt.toISOString(),
        lastHealedAt: b.lastHealedAt.toISOString(),
      };
    });

  // Bulk-fetch SelectorState rows for the top hotspots in a single DB call,
  // then merge them into each hotspot. The default `status=active` filter
  // hides muted/pending/resolved selectors so the live list, CI gate, and
  // webhook digest all see only "still actively breaking" selectors.
  //
  // The state is looked up only for selectors already in this (scoped) list,
  // but the row is lab-wide and not scoped: `status`, `regression_count`,
  // `clean_builds_count`, `last_event_at`, `resolved_at` and the
  // `*_by_api_key` ids move with any team's heals, builds and admin actions.
  let stateMap = new Map<string, any>();
  if (topHotspots.length > 0) {
    const states = await prisma.selectorState.findMany({
      where: {
        OR: topHotspots.map((h) => ({
          original_strategy: h.originalStrategy ?? '',
          original_selector: h.originalSelector,
        })),
      },
    });
    stateMap = new Map(
      states.map((s: any) => [`${s.original_strategy}\x00${s.original_selector}`, s]),
    );
  }

  const requestedStatus = opts.status ?? 'active';
  const hotspots: HotspotRow[] = topHotspots
    .map((h) => ({
      ...h,
      state: stateMap.get(`${h.originalStrategy ?? ''}\x00${h.originalSelector}`) ?? null,
    }))
    .filter((h) => filterByStatus(h.state, requestedStatus));

  return {
    totalScanned: rows.length,
    totalHeals: rows.length,
    distinctSelectors: buckets.size,
    sessionsTouched: sessionsTouched.size,
    byTier,
    hotspots,
  };
}

// CI gate endpoint. CI runs this against a build and inspects
// `violationCount` to decide whether to soft-fail / warn / block. Always
// returns 200 — CI owns the policy decision, this just supplies the data.
async function getHealingViolations(request: Request, response: Response) {
  const windowDays = parseWindowDays(request.query.windowDays, 7);
  const minHealCountRaw = parseInt((request.query.minHealCount as string) || '5', 10);
  const minHealCount = Number.isFinite(minHealCountRaw)
    ? Math.min(Math.max(minHealCountRaw, 1), 1000)
    : 5;
  const tier = typeof request.query.tier === 'string' && request.query.tier ? request.query.tier : null;
  const platform =
    typeof request.query.platform === 'string' && request.query.platform
      ? request.query.platform
      : null;
  const buildId =
    typeof request.query.build === 'string' && request.query.build ? request.query.build : null;

  const agg = await aggregateHotspots({
    windowDays,
    limit: 100,
    tier,
    platform,
    buildId,
    minHealCount,
    sessionWhere: await visibleSessionWhere(authOf(request)),
  });

  return response.status(200).json({
    windowDays,
    minHealCount,
    filters: { tier, platform, buildId },
    violationCount: agg.hotspots.length,
    totalHeals: agg.totalHeals,
    distinctSelectors: agg.distinctSelectors,
    violations: agg.hotspots,
  });
}

// On-demand digest dispatcher. Fires the current Selector Health summary
// to every webhook subscribed to `selector_health_digest`. Used by the
// dashboard "Send digest now" button and by external schedulers (cron in
// CI, etc.) that want to push a weekly digest to Slack.
async function sendHealingDigest(request: Request, response: Response) {
  const windowDays = parseWindowDays(
    request.body?.windowDays ?? request.query?.windowDays,
    7,
  );
  const limit = Math.min(
    Math.max(parseInt(String(request.body?.limit ?? request.query?.limit ?? '5'), 10) || 5, 1),
    20,
  );
  const minHealCountRaw = parseInt(
    String(request.body?.minHealCount ?? request.query?.minHealCount ?? '2'),
    10,
  );
  const minHealCount = Number.isFinite(minHealCountRaw)
    ? Math.min(Math.max(minHealCountRaw, 1), 1000)
    : 2;

  // Every team's heals, on purpose: admin-only, and the digest goes to the
  // lab's webhooks rather than back to one caller.
  const agg = await aggregateHotspots({ windowDays, limit, minHealCount });
  const payload = {
    windowDays,
    totalHeals: agg.totalHeals,
    distinctSelectors: agg.distinctSelectors,
    hotspots: agg.hotspots,
  };

  const notifier = Container.get(NotificationService);
  const configs = await notifier.getConfigs();
  const subscribed = configs.filter((c) => {
    if (!c.active) return false;
    try {
      const events = JSON.parse(c.events) as string[];
      return events.includes('selector_health_digest');
    } catch {
      return false;
    }
  });

  await notifier.dispatchEvent('selector_health_digest', payload);

  return response.status(200).json({
    sent: subscribed.length,
    windowDays,
    hotspotsIncluded: agg.hotspots.length,
  });
}

// Drill-down for one selector — surfaces every alternate the healer landed
// on (so the user can pick a rewrite intelligently), per-tier/platform/build
// breakdowns, and a recent timeline with session links.
async function getHealingSelectorDetail(request: Request, response: Response) {
  const value = typeof request.query.value === 'string' ? request.query.value : '';
  if (!value) {
    return response.status(400).json({ error: true, message: 'value query param is required' });
  }
  const windowDays = parseWindowDays(request.query.windowDays);
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  // Only the caller's sessions: a selector healed only on phones they can't
  // see reads as one with no heals.
  const rows = await prisma.sessionLog.findMany({
    where: {
      is_healed: true,
      original_selector: value,
      createdAt: { gte: since },
      ...(await visibleLogScope(request)),
    },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    include: {
      session: {
        select: {
          id: true,
          build_id: true,
          device_udid: true,
          device_name: true,
          device_platform: true,
        },
      },
    },
  });

  const sessions = new Set<string>();
  const alternates = new Map<
    string,
    { count: number; confidenceSum: number; confidenceSamples: number; tiers: Set<string> }
  >();
  const byTier: Record<string, number> = {};
  const byPlatform: Record<string, number> = {};
  const byBuild: Record<string, number> = {};

  for (const r of rows) {
    sessions.add(r.session_id);
    if (r.healed_selector) {
      const a = alternates.get(r.healed_selector) ?? {
        count: 0,
        confidenceSum: 0,
        confidenceSamples: 0,
        tiers: new Set<string>(),
      };
      a.count += 1;
      if (typeof r.healing_confidence === 'number') {
        a.confidenceSum += r.healing_confidence;
        a.confidenceSamples += 1;
      }
      if (r.healing_tier) a.tiers.add(r.healing_tier);
      alternates.set(r.healed_selector, a);
    }
    if (r.healing_tier) byTier[r.healing_tier] = (byTier[r.healing_tier] || 0) + 1;
    const platform = r.session?.device_platform ?? 'unknown';
    byPlatform[platform] = (byPlatform[platform] || 0) + 1;
    const buildId = r.session?.build_id ?? 'unattached';
    byBuild[buildId] = (byBuild[buildId] || 0) + 1;
  }

  const alternatesList = Array.from(alternates.entries())
    .map(([healedSelector, a]) => ({
      healedSelector,
      count: a.count,
      share: rows.length > 0 ? a.count / rows.length : 0,
      averageConfidence:
        a.confidenceSamples > 0 ? a.confidenceSum / a.confidenceSamples : null,
      tiers: Array.from(a.tiers),
    }))
    .sort((a, b) => b.count - a.count);

  const timeline = rows.slice(0, 100).map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    buildId: r.session?.build_id ?? null,
    deviceUdid: r.session?.device_udid ?? null,
    deviceName: r.session?.device_name ?? null,
    devicePlatform: r.session?.device_platform ?? null,
    commandName: r.command_name ?? null,
    healedSelector: r.healed_selector ?? null,
    confidence: r.healing_confidence ?? null,
    tier: r.healing_tier ?? null,
    isSuccess: r.is_success ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  return response.status(200).json({
    originalSelector: value,
    windowDays,
    healCount: rows.length,
    sessionCount: sessions.size,
    byTier,
    byPlatform,
    byBuild: Object.entries(byBuild)
      .map(([buildId, count]) => ({ buildId, count }))
      .sort((a, b) => b.count - a.count),
    alternates: alternatesList,
    timeline,
  });
}

// Selector health feed for external/plugin consumers (the xenon-studio MCP
// plugin's `xenon_selector_health` tool). Deliberately a thin data-shaping
// layer: it reuses `aggregateHotspots` for the base rows (no new aggregation
// SQL) and `HealEtalonService` for the "how stale is this locator's known-good
// signature" enrichment (no new etalon lookup).
//
// `failRate` is intentionally NOT included — the underlying rows have no
// attempt/failure denominator to compute it from (documented deferral).
//
// `appId` is accepted for forward-compatibility with the tool's filter
// surface but ignored: `HotspotRow` (and the `SessionLog` rows it's built
// from) carry no app id to filter on today.
//
// Bound: results come from the top-1000 hotspot buckets within the last 365 days, so a selector with very low heal volume or heals older than a year may return empty (not an error).
export async function getSelectorHealth(request: Request, response: Response) {
  const selectorFilter =
    typeof request.query.selector === 'string' && request.query.selector
      ? request.query.selector
      : null;
  const limitRaw = parseInt((request.query.limit as string) || '50', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  // Pull a wide window/limit from the shared aggregation so an exact
  // `?selector=` match isn't starved by hotspots' own top-N cutoff, and so
  // this "health" view (unlike the "active work queue" hotspots view)
  // surfaces muted/pending/resolved selectors too — then apply the
  // requested `limit` ourselves after filtering.
  const agg = await aggregateHotspots({
    windowDays: 365,
    limit: 1000,
    status: 'all',
    sessionWhere: await visibleSessionWhere(authOf(request)),
  });

  let rows = agg.hotspots;
  if (selectorFilter) {
    rows = rows.filter((h) => h.originalSelector === selectorFilter);
  }
  rows = rows.slice(0, limit);

  const etalonService = Container.get(HealEtalonService);
  const now = Date.now();
  const results = await Promise.all(
    rows.map(async (h) => {
      const out: {
        selector: string;
        strategy: string | null;
        healCount: number;
        topTier: string | null;
        suggestedRewrite: string | null;
        state: any | null;
        lastHealedAt: string;
        etalonAge?: number;
      } = {
        selector: h.originalSelector,
        strategy: h.originalStrategy,
        healCount: h.healCount,
        topTier: h.topTier,
        suggestedRewrite: h.suggestedRewrite,
        state: h.state ?? null,
        lastHealedAt: h.lastHealedAt,
      };

      // LocatorEtalon.selector is unique, so a lookup by selector alone
      // already pins the row; the strategy check guards against treating a
      // stale/unrelated etalon (selector reused under a different strategy)
      // as a match for this hotspot's (selector, strategy) tuple. Shared, not
      // scoped: one etalon per selector, refreshed by any team's session.
      const etalon = await etalonService.getSignature(h.originalSelector);
      if (etalon && etalon.strategy === h.originalStrategy) {
        out.etalonAge = now - etalon.lastSeen;
      }

      return out;
    }),
  );

  return response.status(200).json(results);
}

// SelectorState lifecycle action endpoint — mark fixed / mute / unmute /
// cancel verification. The action vocabulary is closed (any value not in
// VALID_ACTIONS rejects with 400). A SelectorStateConflictError surfaces as
// 409 with `currentStatus`; anything else logs and surfaces as 500.
const VALID_SELECTOR_ACTIONS = ['mark_fixed', 'mute', 'unmute', 'cancel_verification'] as const;
type SelectorAction = (typeof VALID_SELECTOR_ACTIONS)[number];

export async function postSelectorStateAction(request: Request, response: Response) {
  const { original_strategy, original_selector, action } = (request.body ?? {}) as {
    original_strategy?: string;
    original_selector?: string;
    action?: string;
  };
  if (!original_strategy || !original_selector || !action) {
    return response.status(400).json({
      error: 'original_strategy, original_selector, and action are required',
    });
  }
  if (!(VALID_SELECTOR_ACTIONS as readonly string[]).includes(action)) {
    return response.status(400).json({
      error: `action must be one of ${VALID_SELECTOR_ACTIONS.join(', ')}`,
    });
  }

  const apiKeyId = request.apiKey?.id ?? '';
  const ctx = { strategy: original_strategy, selector: original_selector, apiKeyId };
  const service = Container.get(SelectorStateService);

  try {
    let row;
    switch (action as SelectorAction) {
      case 'mark_fixed':
        row = await service.markFixed(ctx);
        break;
      case 'mute':
        row = await service.mute(ctx);
        break;
      case 'unmute':
        row = await service.unmute(ctx);
        break;
      case 'cancel_verification':
        row = await service.cancelVerification(ctx);
        break;
    }
    return response.json({ state: row });
  } catch (err: any) {
    if (err instanceof SelectorStateConflictError) {
      return response.status(409).json({ error: err.message, currentStatus: err.currentStatus });
    }
    log.error(`[Dashboard] selector state action failed: ${err?.message ?? err}`);
    return response.status(500).json({ error: 'internal' });
  }
}

// Muted-selectors list — sourced directly from SelectorState (not the
// hotspot aggregator) so muted-but-no-recent-heal entries still surface.
// Each row is enriched with `last_healed_at` from the most recent healed
// SessionLog row for that tuple (null if never healed).
//
// The mute is lab-wide state, so every caller gets the same rows and
// `muted_at`, `muted_by_api_key` and `regression_count`. `last_healed_at` is
// heal data, so it is the latest heal among the sessions the caller may see:
// null for a selector only another team has healed.
export async function getMutedSelectors(request: Request, response: Response) {
  const limit = Math.min(
    Math.max(parseInt(String(request.query.limit ?? '50'), 10) || 50, 1),
    200,
  );
  const offset = Math.max(parseInt(String(request.query.offset ?? '0'), 10) || 0, 0);

  const muted = await prisma.selectorState.findMany({
    where: { status: 'muted' },
    orderBy: { muted_at: 'desc' },
    take: limit,
    skip: offset,
  });
  const total = await prisma.selectorState.count({ where: { status: 'muted' } });

  const scope = await visibleLogScope(request);
  const enriched = await Promise.all(
    muted.map(async (s) => {
      const last = await prisma.sessionLog.findFirst({
        where: {
          original_strategy: s.original_strategy,
          original_selector: s.original_selector,
          is_healed: true,
          ...scope,
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      return {
        original_strategy: s.original_strategy,
        original_selector: s.original_selector,
        muted_at: s.muted_at ? s.muted_at.toISOString() : null,
        muted_by_api_key: s.muted_by_api_key,
        last_healed_at: last?.createdAt ? last.createdAt.toISOString() : null,
        regression_count: s.regression_count,
      };
    }),
  );

  return response.json({ muted: enriched, total, limit, offset });
}

// Single-tuple state lookup. Strategy and value arrive URL-encoded since
// XPath selectors contain `/` and `[`. Returns `{ state: null }` when no
// row exists (intentional — null is meaningful: the selector is implicitly
// active). The raw SelectorState row only, with no heal-derived field, so it
// answers the same for every caller: the row is lab-wide state.
export async function getSelectorStateByTuple(request: Request, response: Response) {
  const strategy = decodeURIComponent(request.params.strategy ?? '');
  const value = decodeURIComponent(request.params.value ?? '');
  const row = await prisma.selectorState.findUnique({
    where: {
      original_strategy_original_selector: {
        original_strategy: strategy,
        original_selector: value,
      },
    },
  });
  return response.json({ state: row });
}

/** The session folders the dashboard shows (asset-manager.ts). Interceptor captures and recordings have their own rules. */
const SESSION_ASSET_KINDS = new Set(['screenshots', 'video', 'performance']);
/** One file name, no path and no leading dot. */
const SESSION_ASSET_FILE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * A session's stored screenshot, video or performance trace, stored as
 * `<sessionId>/<kind>/<file>` under sessionAssetsPath. Behind isValidSession,
 * so the caller must be able to see the session. Supports Range, for video
 * seeking. This replaced an express.static mount outside the API's login.
 */
async function getSessionAsset(request: Request, response: Response) {
  const { sessionId, kind, file } = request.params as Record<string, string>;
  const notFound = () =>
    response.status(404).json({ error: true, message: 'Session asset not found' });
  if (!SESSION_ASSET_KINDS.has(kind) || !SESSION_ASSET_FILE.test(file)) return notFound();
  response.sendFile(
    file,
    {
      root: path.join(config.sessionAssetsPath, sessionId, kind),
      headers: { 'Cache-Control': 'private, max-age=300' },
    },
    (err?: any) => {
      if (!err || response.headersSent) return;
      if (err.status === 416 || err.statusCode === 416) return response.status(416).end();
      notFound();
    },
  );
}

async function getProfilingData(request: Request, response: Response) {
  const sessionId = request.params.sessionId;

  const profilingData = await prisma.profiling.findMany({
    orderBy: {
      timestamp: 'asc',
    },
    where: {
      session_id: sessionId,
    },
  });
  return response.status(200).json(profilingData);
}

/** A session's CPU and memory samples, for the Performance panel. */
async function getSessionMetrics(request: Request, response: Response) {
  const sessionId = request.params.sessionId;
  const [session, rows] = await Promise.all([
    prisma.session.findFirst({
      where: { id: sessionId },
      select: { device_platform: true, status: true },
    }),
    prisma.sessionMetric.findMany({ where: { session_id: sessionId }, orderBy: { at: 'asc' } }),
  ]);
  // A running session's page says whether it is sampled, not "Collecting…" for one nothing samples.
  const recording =
    session?.status === 'running'
      ? Container.get(SessionMetricsService).recordingState(sessionId)
      : null;
  return response
    .status(200)
    .json(sessionMetricsBody(session?.device_platform ?? '', rows, recording));
}

async function streamLiveSessionVideo(request: Request, response: Response) {
  const sessionId = request.params.sessionId;
  const session = SESSION_MANAGER.getSession(sessionId);

  const videoUrl = session?.getLiveVideoUrl();
  if (videoUrl) {
    // Recreate when there's no cached proxy, the upstream url changed, OR the
    // cached proxy has permanently stopped (a stopped proxy 503s every request
    // — see shouldRecreateMjpegProxy). Evict the old one first so a url change
    // doesn't leak its upstream connection.
    const existingProxy = MJPEG_PROXY_CACHE.get(sessionId);
    if (shouldRecreateMjpegProxy(existingProxy, videoUrl)) {
      existingProxy?.stop();
      MJPEG_PROXY_CACHE.set(sessionId, new UniversalMjpegProxy(videoUrl));
    }

    MJPEG_PROXY_CACHE.get(sessionId)?.proxyRequest(request, response);
  } else {
    return response.status(500).send({
      error: true,
      message: `Live video not available for session with id ${sessionId}`,
    });
  }
}

async function getGlobalConfig(request: Request, response: Response) {
  try {
    const dbConfig = await Container.get(WebConfigService).getConfig();
    // Merge with Environment Config (AI Settings)
    const { config } = await import('../../config');

    // Sanitize keys - return boolean existence only
    const aiConfig = {
      aiProvider: config.aiProvider,
      aiModel: config.aiModel,
      aiBaseUrl: config.aiBaseUrl,
      geminiModel: config.geminiModel,
      openaiModel: config.openaiModel,
      anthropicModel: config.anthropicModel,
      ollamaModel: config.ollamaModel,
      geminiSet: !!config.geminiApiKey,
      openaiSet: !!config.openaiApiKey,
      anthropicSet: !!config.anthropicApiKey,
    };

    return response.status(200).json({ ...dbConfig, ...aiConfig });
  } catch (err: any) {
    return response.status(500).json({ error: true, message: err.message });
  }
}

async function updateGlobalConfig(request: Request, response: Response) {
  try {
    const payload = request.body;

    // Handle Runtime AI Config Overrides (Memory only)
    // Only pass defined values to avoid overwriting env vars (e.g. aiBaseUrl, ollamaModel) with undefined
    const runtimeOverrides: Record<string, any> = {};
    if (payload.aiProvider !== undefined) runtimeOverrides.aiProvider = payload.aiProvider;
    if (payload.aiModel !== undefined) runtimeOverrides.aiModel = payload.aiModel;
    if (payload.aiBaseUrl !== undefined) runtimeOverrides.aiBaseUrl = payload.aiBaseUrl;
    if (payload.geminiModel !== undefined) runtimeOverrides.geminiModel = payload.geminiModel;
    if (payload.openaiModel !== undefined) runtimeOverrides.openaiModel = payload.openaiModel;
    if (payload.anthropicModel !== undefined)
      runtimeOverrides.anthropicModel = payload.anthropicModel;
    if (payload.ollamaModel !== undefined) runtimeOverrides.ollamaModel = payload.ollamaModel;

    if (Object.keys(runtimeOverrides).length > 0) {
      const { updateConfig } = await import('../../config');
      updateConfig(runtimeOverrides);
    }

    // Persist Web Configs to DB
    await Container.get(WebConfigService).setConfig(payload);
    return response.status(200).json({ success: true });
  } catch (err: any) {
    return response.status(500).json({ error: true, message: err.message });
  }
}

async function resetMetrics(request: Request, response: Response) {
  try {
    const { DeviceStoreFactory } = await import('../../data-service/device-store');
    const store = DeviceStoreFactory.getStore();
    await store.resetMetrics();
    return response.status(200).json({ success: true });
  } catch (err: any) {
    return response.status(500).json({ error: true, message: err.message });
  }
}

function register(router: Router) {
  router.use('/session/:sessionId', isValidSession);
  router.use(roleGuard('MEMBER'));

  router.get('/session', getSessions);
  router.get('/session-summary', getSessionSummary);
  router.get('/session/:sessionId', getSessionById);
  router.get('/build', getBuilds);
  buildExportModule.register(router);
  router.get('/session/:sessionId/live_video', streamLiveSessionVideo);
  router.get('/session/:sessionId/session_log', getSessionLogs);
  router.get('/session/:sessionId/logs/device', getDeviceLogs);
  router.get('/session/:sessionId/logs/debug', getDebugLogs);
  router.get('/session/:sessionId/profiling', getProfilingData);
  router.get('/session/:sessionId/metrics', getSessionMetrics);
  router.get('/session/:sessionId/asset/:kind/:file', getSessionAsset);
  // The healing reads count only heals from sessions the caller may see
  // (visibleSessionWhere); the digest below counts every team's.
  router.get('/healing/events', getRecentHealingEvents);
  router.get('/healing/summary', getHealingSummary);
  router.get('/healing/hotspots', getHealingHotspots);
  router.get('/healing/hotspots/violations', getHealingViolations);
  router.get('/healing/selector', getHealingSelectorDetail);
  router.get('/healing/selector-health', getSelectorHealth);
  // Outbound notification — admin only since it can fan out to every
  // configured webhook (Slack channels, etc.).
  router.post('/healing/digest/send', roleGuard('ADMIN'), scopeGuard(['admin']), sendHealingDigest);
  // SelectorState lifecycle: state mutations require admin (they affect what
  // shows up in the live hotspot list, the CI gate, and the digest); the two
  // reads inherit the existing dashboard auth. Both reads stay global, not
  // team-scoped: a selector's mute or fix is one lab-wide row with no team
  // column, shared by every team whose tests use that selector. The one
  // heal-derived field, the muted list's `last_healed_at`, is the caller's.
  router.post('/healing/selector/state', roleGuard('ADMIN'), scopeGuard(['admin']), postSelectorStateAction);
  router.get('/healing/state/muted', getMutedSelectors);
  router.get('/healing/state/:strategy/:value', getSelectorStateByTuple);
  router.get('/config', getGlobalConfig);
  // Config + destructive ops: admin-only. Read-only config stays open to any
  // authenticated key so dashboards using 'read' scope can still populate.
  router.post('/config', roleGuard('ADMIN'), scopeGuard(['admin']), updateGlobalConfig);
  router.post('/config/reset-metrics', roleGuard('ADMIN'), scopeGuard(['admin']), resetMetrics);
}

export default {
  register,
};
