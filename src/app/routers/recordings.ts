import { Router, Request, Response } from 'express';
import { Container } from 'typedi';
import * as fs from 'fs';
import {
  RecordingOrchestrator,
  RecordingError,
  compositeOutputPath,
} from '../../services/recording/RecordingOrchestrator';
import { ProofBundleService } from '../../services/recording/proof-bundle';
import { AnnotationRenderService } from '../../services/recording/annotation-render';
import { RecordingStore } from '../../services/recording/recording-store';
import { roleGuard } from '../../middleware/roleGuard';
import { filterRowsByVisibleDevice } from '../../data-service/device-service';
import { prisma } from '../../prisma';
import log from '../../logger';

// Phase 4A: a recording group is visible if at least one of its rows runs on
// a device the caller can see. Used by GET /recordings/:groupId and the
// binary endpoints (composite mp4, bundle zip). Returns:
//   true  → admin (no filter) or at least one row is visible to caller
//   false → none of the group's rows are on a visible device → 404
async function isGroupVisibleToAuth(
  groupId: string,
  teamIds: string[] | undefined,
): Promise<boolean> {
  if (teamIds === undefined) return true;
  const rows = await prisma.recording.findMany({
    where: { group_id: groupId },
    select: { device_udid: true },
  });
  if (rows.length === 0) return false;
  const visible = await filterRowsByVisibleDevice(rows, teamIds, 'device_udid');
  return visible.length > 0;
}

const recLog = log.scope('RecordingsRouter');
const router = Router();
router.use(roleGuard('MEMBER'));

router.post('/recordings', async (req: Request, res: Response) => {
  const { udids, sessionId, note } = req.body ?? {};
  if (!Array.isArray(udids) || udids.length === 0) {
    return res.status(400).json({ error: 'udids must be a non-empty array' });
  }
  for (const u of udids) {
    if (typeof u !== 'string' || u.length === 0) {
      return res.status(400).json({ error: 'every udid must be a non-empty string' });
    }
  }
  const actorId = req.apiKey?.id;
  if (!actorId) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const out = await Container.get(RecordingOrchestrator).start({
      udids,
      sessionId,
      note,
      actorId,
    });
    return res.status(202).json(out);
  } catch (e: any) {
    if (e instanceof RecordingError) {
      if (e.code === 'concurrency_cap') {
        return res.status(409).json({
          error: 'concurrency_cap',
          limit: e.limit,
          active: e.active,
          message: `Server-wide recording cap reached (${e.active}/${e.limit}).`,
        });
      }
      const busyDevices = e.busyDevices ?? [];
      return res.status(409).json({
        error: 'device_busy',
        busyDevices,
        message: `${busyDevices.length} of ${udids.length} selected devices are busy. Recording was not started.`,
      });
    }
    recLog.error(`POST /recordings failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.post('/recordings/:groupId/add-device', async (req: Request, res: Response) => {
  const { udid } = req.body ?? {};
  if (typeof udid !== 'string' || udid.length === 0) {
    return res.status(400).json({ error: 'udid must be a non-empty string' });
  }
  const actorId = req.apiKey?.id;
  if (!actorId) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const out = await Container.get(RecordingOrchestrator).addDevice(
      req.params.groupId,
      udid,
      actorId,
    );
    return res.status(201).json(out);
  } catch (e: any) {
    if (e instanceof RecordingError) {
      if (e.code === 'concurrency_cap') {
        return res.status(409).json({
          error: 'concurrency_cap',
          limit: e.limit,
          active: e.active,
          message: `Server-wide recording cap reached (${e.active}/${e.limit}).`,
        });
      }
      const busyDevices = e.busyDevices ?? [];
      return res.status(409).json({
        error: 'device_busy',
        busyDevices,
        message: `Device is busy. Recording was not started.`,
      });
    }
    recLog.error(`POST /recordings/:groupId/add-device failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.post('/recordings/:groupId/stop', async (req: Request, res: Response) => {
  try {
    const out = await Container.get(RecordingOrchestrator).stop(req.params.groupId);
    res.json(out);
  } catch (e: any) {
    recLog.error(`POST /recordings/:groupId/stop failed: ${e?.message}`);
    res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.post('/recordings/:groupId/bookmark', async (req: Request, res: Response) => {
  const { recordingId, timecodeMs, label, note } = req.body ?? {};
  if (typeof recordingId !== 'string' || typeof label !== 'string' || typeof timecodeMs !== 'number') {
    return res
      .status(400)
      .json({ error: 'recordingId (string), timecodeMs (number) and label (string) are required' });
  }
  try {
    const out = await Container.get(RecordingOrchestrator).addBookmark(
      req.params.groupId,
      recordingId,
      timecodeMs,
      label,
      note,
    );
    res.status(201).json(out);
  } catch (e: any) {
    recLog.error(`bookmark failed: ${e?.message}`);
    res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.post('/recordings/:groupId/annotation', async (req: Request, res: Response) => {
  const { recordingId, timecodeMs, shape, geometry, color, text, author } = req.body ?? {};
  if (
    typeof recordingId !== 'string' ||
    typeof timecodeMs !== 'number' ||
    typeof shape !== 'string' ||
    typeof geometry !== 'string' ||
    typeof color !== 'string'
  ) {
    return res.status(400).json({
      error: 'recordingId, timecodeMs, shape, geometry, color are required',
    });
  }
  try {
    const out = await Container.get(RecordingOrchestrator).addAnnotation(
      req.params.groupId,
      recordingId,
      { timecodeMs, shape, geometry, color, text, author },
    );
    res.status(201).json(out);
  } catch (e: any) {
    recLog.error(`annotation failed: ${e?.message}`);
    res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.get('/recordings/:groupId', async (req: Request, res: Response) => {
  try {
    const recs = await Container.get(RecordingStore).listGroup(req.params.groupId);
    // Phase 4A: filter the per-device rows to those whose device is visible
    // to the caller. 404 the whole group if none are visible.
    const auth = (req as Request & { auth?: { teamIds?: string[] } }).auth;
    const visibleRecs = await filterRowsByVisibleDevice(
      recs,
      auth?.teamIds,
      'device_udid',
    );
    if (auth?.teamIds !== undefined && visibleRecs.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({ groupId: req.params.groupId, recordings: visibleRecs });
  } catch (e: any) {
    res.status(500).json({ error: 'internal', message: e?.message });
  }
});

/**
 * Stream the mosaic-wide composite mp4 for a group. 404s when no composite
 * exists (single-device groups skip composite by design).
 */
router.get('/recordings/:groupId/composite.mp4', async (req: Request, res: Response) => {
  // Phase 4A: 404 if none of the group's devices are visible to the caller.
  const auth = (req as Request & { auth?: { teamIds?: string[] } }).auth;
  if (!(await isGroupVisibleToAuth(req.params.groupId, auth?.teamIds))) {
    return res.status(404).json({ error: 'composite_not_found' });
  }
  const compositePath = compositeOutputPath(req.params.groupId);
  if (!fs.existsSync(compositePath)) {
    return res.status(404).json({ error: 'composite_not_found' });
  }
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  fs.createReadStream(compositePath).pipe(res);
});

router.get('/recordings/:groupId/bundle.zip', async (req: Request, res: Response) => {
  // Phase 4A: 404 if none of the group's devices are visible to the caller.
  const auth = (req as Request & { auth?: { teamIds?: string[] } }).auth;
  if (!(await isGroupVisibleToAuth(req.params.groupId, auth?.teamIds))) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="proof-${req.params.groupId}.zip"`,
  );
  const archive = Container.get(ProofBundleService).streamBundleZip(req.params.groupId);
  archive.on('error', (err) => {
    recLog.error(`bundle stream error: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal', message: err.message });
    } else {
      res.destroy();
    }
  });
  archive.pipe(res);
});

router.get(
  '/recordings/:groupId/exports/annotated.mp4',
  async (req: Request, res: Response) => {
    const recordingId = String(req.query.recordingId ?? '');
    if (!recordingId) {
      return res.status(400).json({ error: 'recordingId query param is required' });
    }
    // Phase 4A: 404 if the recording's device is not visible to the caller.
    const auth = (req as Request & { auth?: { teamIds?: string[] } }).auth;
    if (auth?.teamIds !== undefined) {
      const rec = await prisma.recording.findUnique({
        where: { id: recordingId },
        select: { device_udid: true },
      });
      if (!rec) return res.status(404).json({ error: 'not_found' });
      const dev = await prisma.device.findFirst({
        where: { udid: rec.device_udid },
        select: { teamId: true },
      });
      const visible = dev && (dev.teamId === null || auth.teamIds.includes(dev.teamId));
      if (!visible) return res.status(404).json({ error: 'not_found' });
    }
    try {
      const { stream, cleanup } = await Container.get(
        AnnotationRenderService,
      ).renderForRecording(recordingId);
      res.setHeader('Content-Type', 'video/mp4');
      stream.pipe(res);
      res.on('close', cleanup);
      stream.on('end', cleanup);
    } catch (e: any) {
      recLog.error(`annotated.mp4 render failed: ${e?.message}`);
      res.status(500).json({ error: 'render_failed', message: e?.message });
    }
  },
);

function register(parentRouter: Router) {
  parentRouter.use('/', router);
}

export default { register };
