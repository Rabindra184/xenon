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
import log from '../../logger';
import { SocketServer } from '../../services/SocketServer';
import { SocketEvents } from '../../enums/SocketEvents';

const router = Router();

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

  const svc = Container.get(BugReportService);
  let bundle;
  try {
    bundle = await svc.assemble({ sessionId, mode, windowSec });
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
      Container.get(SocketServer).broadcast(SocketEvents.BUG_REPORT_GENERATED, {
        sessionId,
        mode,
        durationMs: Date.now() - startedAt,
        warnings: bundle.manifest.warnings,
      });
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
