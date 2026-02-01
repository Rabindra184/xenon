import { Request, Response, Router, NextFunction } from 'express';
import { prisma } from '../../prisma';
import { SESSION_MANAGER } from '../../sessions/SessionManager';
import { MjpegProxy } from 'mjpeg-proxy';

const MJPEG_PROXY_CACHE: Map<string, any> = new Map();

//session gaurd
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
      message: `Sesssion with id ${sessionId} not found`,
    });
  } else {
    return next();
  }
}

async function getSessions(request: Request, response: Response) {
  const buildId = request.query.buildId || undefined;
  const sessions = await prisma.session.findMany({
    orderBy: {
      createdAt: 'desc',
    },
    where: {
      build: buildId ? { id: buildId as any } : undefined,
    },
    take: 500, // Principal Fix: Do not crash the UI with 10k rows
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
    passedCount: b.sessions.filter((s) => s.status === 'success').length,
    failedCount: b.sessions.filter((s) => s.status === 'failed').length,
    runningCount: b.sessions.filter((s) => s.status === 'running').length,
    sessions: undefined, // remove raw sessions for payload efficiency
  }));

  return response.status(200).json(formattedBuilds);
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
      MJPEG_PROXY_CACHE.set(sessionId, new MjpegProxy(videoUrl));
    }

    MJPEG_PROXY_CACHE.get(sessionId)?.proxyRequest(request, response);
  } else {
    return response.status(500).send({
      error: true,
      message: `Live video not available for session with id ${sessionId}`,
    });
  }
}

function register(router: Router) {
  router.use('/session/:sessionId', isValidSession);

  router.get('/session', getSessions);
  router.get('/build', getBuilds);
  router.get('/session/:sessionId/live_video', streamLiveSessionVideo);
  router.get('/session/:sessionId/session_log', getSessionLogs);
  router.get('/session/:sessionId/logs/device', getDeviceLogs);
  router.get('/session/:sessionId/logs/debug', getDebugLogs);
  router.get('/session/:sessionId/profiling', getProfilingData);
}

export default {
  register,
};
