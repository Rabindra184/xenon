import { Request, Response, Router, NextFunction } from 'express';
import { prisma } from '../../prisma';
import { SESSION_MANAGER } from '../../sessions/SessionManager';
import { UniversalMjpegProxy } from '../../helpers/UniversalMjpegProxy';
import { WebConfigService } from '../../data-service/web-config-service';
import { Container } from 'typedi';
import { scopeGuard } from '../../middleware/scopeGuard';
import { buildExport } from './build-export';

const MJPEG_PROXY_CACHE: Map<string, any> = new Map();

//session guard
async function isValidSession(request: Request, response: Response, next: NextFunction) {
  const sessionId = request.params.sessionId;

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
    },
  });
  if (!session) {
    return response.status(404).send({
      error: true,
      message: `Session with id ${sessionId} not found`,
    });
  } else {
    return next();
  }
}

async function getSessions(request: Request, response: Response) {
  const { buildId, query, status, platform } = request.query;

  const where: any = {};

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

  const sessions = await prisma.session.findMany({
    orderBy: {
      createdAt: 'desc',
    },
    where,
    take: 500,
  });
  return response.status(200).json(sessions);
}

async function getBuilds(request: Request, response: Response) {
  const builds = await prisma.build.findMany({
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      _count: {
        select: { sessions: true },
      },
      sessions: {
        select: {
          status: true,
        },
      },
    },
  });

  // Principal formatting: Add a flat summary object for the frontend
  const formattedBuilds = builds.map((b) => ({
    ...b,
    sessionCount: b._count.sessions,
    passedCount: b.sessions.filter((s) => ['success', 'passed'].includes(s.status)).length,
    failedCount: b.sessions.filter((s) => s.status === 'failed').length,
    runningCount: b.sessions.filter((s) => s.status === 'running').length,
    sessions: undefined, // remove raw sessions for payload efficiency
  }));

  return response.status(200).json(formattedBuilds);
}

async function getSessionById(request: Request, response: Response) {
  const sessionId = request.params.sessionId;
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });
  if (!session) {
    return response.status(404).json({ error: true, message: 'Session not found' });
  }
  return response.status(200).json(session);
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

async function getRecentHealingEvents(request: Request, response: Response) {
  const limitRaw = parseInt((request.query.limit as string) || '50', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  const [rows, todayCount] = await Promise.all([
    prisma.sessionLog.findMany({
      where: { is_healed: true },
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
      where: { is_healed: true, createdAt: { gte: startOfTodayUtc() } },
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

// Rough per-heal cost estimates in USD. Local tiers are effectively free
// (CPU/inference cost only); LLM is the headline number testers should
// optimize against. Surfaced so engineering managers can quantify suite
// hygiene work without reading raw billing data.
const TIER_COST_USD: Record<string, number> = {
  Native: 0,
  Resilio: 0,
  'Fuzzy XML': 0,
  OCR: 0.0005,
  'Visual AI': 0.002,
  LLM: 0.04,
};

function estimateCost(byTier: Record<string, number>): number {
  let sum = 0;
  for (const [tier, count] of Object.entries(byTier)) {
    sum += (TIER_COST_USD[tier] ?? 0) * count;
  }
  return sum;
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

  const [currentRows, priorRows] = await Promise.all([
    prisma.sessionLog.findMany({
      where: {
        is_healed: true,
        createdAt: { gte: since, lte: now },
        original_selector: { not: null },
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
      estCostUsd: estimateCost(byTier),
    };
  };

  const current = aggregate(currentRows);
  const prior = aggregate(priorRows);

  return response.status(200).json({
    windowDays,
    current,
    prior,
  });
}

async function getHealingHotspots(request: Request, response: Response) {
  const windowDays = parseWindowDays(request.query.windowDays);
  const limitRaw = parseInt((request.query.limit as string) || '20', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
  const tierFilter =
    typeof request.query.tier === 'string' && request.query.tier ? request.query.tier : null;
  const platformFilter =
    typeof request.query.platform === 'string' && request.query.platform
      ? request.query.platform
      : null;

  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const where: any = {
    is_healed: true,
    createdAt: { gte: since },
    original_selector: { not: null },
  };
  if (tierFilter) where.healing_tier = tierFilter;
  if (platformFilter) where.session = { device_platform: platformFilter };

  const rows = await prisma.sessionLog.findMany({
    where,
    select: {
      session_id: true,
      original_selector: true,
      healed_selector: true,
      healing_confidence: true,
      healing_tier: true,
      createdAt: true,
      session: {
        select: { device_platform: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });

  type Bucket = {
    originalSelector: string;
    healCount: number;
    sessions: Set<string>;
    tiers: Map<string, number>;
    healedSelectors: Map<string, number>;
    confidenceSum: number;
    confidenceSamples: number;
    lastHealedAt: Date;
    firstHealedAt: Date;
  };

  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const key = r.original_selector!;
    let b = buckets.get(key);
    if (!b) {
      b = {
        originalSelector: key,
        healCount: 0,
        sessions: new Set<string>(),
        tiers: new Map<string, number>(),
        healedSelectors: new Map<string, number>(),
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

  const hotspots = Array.from(buckets.values())
    .sort(
      (a, b) =>
        b.healCount - a.healCount || b.lastHealedAt.getTime() - a.lastHealedAt.getTime(),
    )
    .slice(0, limit)
    .map((b) => {
      const topRewrite = pickTopEntry(b.healedSelectors);
      const topTier = pickTopEntry(b.tiers);
      return {
        originalSelector: b.originalSelector,
        healCount: b.healCount,
        sessionCount: b.sessions.size,
        suggestedRewrite: topRewrite?.value ?? null,
        suggestedRewriteShare: topRewrite ? topRewrite.count / b.healCount : null,
        topTier: topTier?.value ?? null,
        averageConfidence:
          b.confidenceSamples > 0 ? b.confidenceSum / b.confidenceSamples : null,
        firstHealedAt: b.firstHealedAt.toISOString(),
        lastHealedAt: b.lastHealedAt.toISOString(),
      };
    });

  return response.status(200).json({
    windowDays,
    totalScanned: rows.length,
    filters: { tier: tierFilter, platform: platformFilter },
    hotspots,
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

  const rows = await prisma.sessionLog.findMany({
    where: {
      is_healed: true,
      original_selector: value,
      createdAt: { gte: since },
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
    estCostUsd: estimateCost(byTier),
    byTier,
    byPlatform,
    byBuild: Object.entries(byBuild)
      .map(([buildId, count]) => ({ buildId, count }))
      .sort((a, b) => b.count - a.count),
    alternates: alternatesList,
    timeline,
  });
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

async function streamLiveSessionVideo(request: Request, response: Response) {
  const sessionId = request.params.sessionId;
  const session = SESSION_MANAGER.getSession(sessionId);

  const videoUrl = session?.getLiveVideoUrl();
  if (videoUrl) {
    if (!MJPEG_PROXY_CACHE.has(sessionId)) {
      MJPEG_PROXY_CACHE.set(sessionId, new UniversalMjpegProxy(videoUrl));
    }

    // Principal Robustness: Ensure proxy is updated if URL changes
    const existingProxy = MJPEG_PROXY_CACHE.get(sessionId);
    if (existingProxy && (existingProxy as any).mjpegUrl !== videoUrl) {
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

  router.get('/session', getSessions);
  router.get('/session/:sessionId', getSessionById);
  router.get('/build', getBuilds);
  router.post('/build/:buildId/export', buildExport);
  router.get('/session/:sessionId/live_video', streamLiveSessionVideo);
  router.get('/session/:sessionId/session_log', getSessionLogs);
  router.get('/session/:sessionId/logs/device', getDeviceLogs);
  router.get('/session/:sessionId/logs/debug', getDebugLogs);
  router.get('/session/:sessionId/profiling', getProfilingData);
  router.get('/healing/events', getRecentHealingEvents);
  router.get('/healing/summary', getHealingSummary);
  router.get('/healing/hotspots', getHealingHotspots);
  router.get('/healing/selector', getHealingSelectorDetail);
  router.get('/config', getGlobalConfig);
  // Config + destructive ops: admin-only. Read-only config stays open to any
  // authenticated key so dashboards using 'read' scope can still populate.
  router.post('/config', scopeGuard(['admin']), updateGlobalConfig);
  router.post('/config/reset-metrics', scopeGuard(['admin']), resetMetrics);
}

export default {
  register,
};
