import { Request, Response, Router } from 'express';
import { Container } from 'typedi';
import { BugReportService } from '../../services/bug-report/BugReportService';
import { streamBundleToZip } from '../../services/bug-report/archive';
import {
  BugReportMode,
  SLICE_DEFAULT_SEC,
  SLICE_MAX_SEC,
  SLICE_MIN_SEC,
} from '../../services/bug-report/types';
import { roleGuard } from '../../middleware/roleGuard';
import log from '../../logger';
import { SocketServer } from '../../services/SocketServer';
import { SocketEvents } from '../../enums/SocketEvents';
import { prisma } from '../../prisma';
import { canSeeSession, SessionCaller } from '../../services/device-access/sessionVisibility';

const router = Router();
router.use(roleGuard('MEMBER'));

function parseMode(raw: unknown): BugReportMode | null {
  if (raw === 'slice' || raw === 'full') return raw;
  return null;
}

function parseWindowSec(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return SLICE_DEFAULT_SEC;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < SLICE_MIN_SEC || n > SLICE_MAX_SEC) return null;
  return n;
}

router.post('/sessions/:sessionId/bug-report', async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  const mode = parseMode(req.query.mode);
  if (!mode) {
    return res.status(400).json({ error: 'mode must be "slice" or "full"' });
  }

  let windowSec: number | undefined;
  if (mode === 'slice') {
    const parsed = parseWindowSec(req.query.windowSec);
    if (parsed === null) {
      return res.status(400).json({
        error: `windowSec must be between ${SLICE_MIN_SEC} and ${SLICE_MAX_SEC}`,
      });
    }
    windowSec = parsed;
  }

  // Another team's session gets the service's own unknown-session answer,
  // and nothing is assembled for it.
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { device_udid: true, user_id: true },
  });
  const auth = (req as Request & { auth?: SessionCaller }).auth;
  if (session && !(await canSeeSession(session, auth))) {
    return res.status(404).json({ error: `Session ${sessionId} not found` });
  }

  const svc = Container.get(BugReportService);
  let bundle;
  try {
    // The network capture only for an admin, as /interceptor serves it.
    // Through 2.12 any member who could see the session got it here.
    const includeNetwork = auth?.role === 'ADMIN' || auth?.role === 'SUPER_ADMIN';
    bundle = await svc.assemble({ sessionId, mode, windowSec, includeNetwork });
  } catch (err: any) {
    if (/not found/i.test(err.message)) {
      return res.status(404).json({ error: err.message });
    }
    log.error(`[BugReport] assemble failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${bundle.filename}"`);

  const startedAt = Date.now();
  res.on('finish', () => {
    try {
      // To the dashboards that can see the session's phone, not to every
      // socket: a broadcast also reached other teams and the nodes.
      void Container.get(SocketServer).emitToDashboardForDevices(
        SocketEvents.BUG_REPORT_GENERATED,
        {
          sessionId,
          mode,
          durationMs: Date.now() - startedAt,
          warnings: bundle.manifest.warnings,
        },
        { udid: bundle.manifest.device?.udid },
      );
    } catch (e: any) {
      log.warn(`[BugReport] broadcast failed: ${e.message}`);
    }
  });

  res.on('close', async () => {
    await bundle.cleanup();
  });

  try {
    await streamBundleToZip(bundle.entries, res);
  } catch (err: any) {
    log.error(`[BugReport] stream failed mid-write: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.destroy();
    }
  }
});

function register(parentRouter: Router) {
  parentRouter.use('/', router);
}

export default { register };
