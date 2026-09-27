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
import { resolveActor } from '../../services/device-access/actor';
import * as deviceService from '../../data-service/device-service';
import { prisma } from '../../prisma';
import { parseClearBody } from './recordingRequests';
import { decodeAnnotationImage } from '../../services/recording/annotationImage';
import { selectOwnActiveGroups } from '../../services/recording/activeRecordings';
import { readRecordingTiming } from '../../services/recording/recordingTiming';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { DOWNLOAD_OPTIONS } from './apps';
import log from '../../logger';

/**
 * The group's recordings this caller may see. `ids` is undefined for an
 * admin (no filter). `all` counts the group's rows, so a caller who sees only
 * some phones can be told apart from one who sees them all. `rows` is the
 * group as read here, handed on so a download reads the group only once.
 *
 * A group can mix teams' phones (an admin recorded several teams at once, or a
 * phone moved team afterwards), so a download must carry only these rows:
 * seeing one phone of a group is not seeing the group.
 */
async function visibleRecordings(groupId: string, teamIds: string[] | undefined) {
  const rows = await Container.get(RecordingStore).listGroup(groupId);
  if (teamIds === undefined) return { rows, all: rows.length, ids: undefined };
  const visible = await deviceService.filterRowsByVisibleDevice(rows, teamIds, 'device_udid');
  return { rows, all: rows.length, ids: visible.map((r) => r.id) };
}
type Visible = Awaited<ReturnType<typeof visibleRecordings>>;
const seesNone = (v: Visible) => v.all === 0 || (v.ids !== undefined && v.ids.length === 0);

/**
 * Headers `send` may already have set for the file, wrong on a JSON error.
 * Not Cache-Control: `send` never sets one over the API-wide `no-store`
 * (src/app/index.ts), so removing it would remove the app's own policy.
 */
const JSON_ERROR_STRIPS = ['Content-Disposition', 'Content-Type', 'ETag', 'Last-Modified'];

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
  // Manual locks are keyed on the USER, not the credential — the same basis
  // stream/start writes and deviceAccessGuard reads. Keying on req.apiKey.id
  // here made a recording started from the SDK unreachable to the same human
  // on the dashboard (409 device_held_by_another_user naming a key id), and
  // no upgrade tolerance can close that while this path keeps writing them.
  // resolveActor().userId is populated on every credential path (api-key
  // header pair, cookie session, hub-issued bearer), so the old
  // `req.apiKey?.id ?? auth.userId` fallback is no longer needed.
  const actorId = resolveActor(req).userId;
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
  // Same user-keyed actor basis as POST /recordings above.
  const actorId = resolveActor(req).userId;
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
  const image = decodeAnnotationImage(req.body?.image);
  if (image && !image.ok) return res.status(400).json({ error: image.error });
  try {
    const out = await Container.get(RecordingOrchestrator).addAnnotation(
      req.params.groupId,
      recordingId,
      { timecodeMs, shape, geometry, color, text, author },
      image?.ok ? image.png : undefined,
    );
    res.status(201).json(out);
  } catch (e: any) {
    recLog.error(`annotation failed: ${e?.message}`);
    res.status(500).json({ error: 'internal', message: e?.message });
  }
});

// Registered before GET /recordings/:groupId, which would otherwise read
// "active" as a group id.
router.get('/recordings/active', async (req: Request, res: Response) => {
  try {
    const actor = resolveActor(req);
    const rows = await prisma.recording.findMany({
      where: { status: 'RECORDING' },
      include: { annotations: true },
    });
    const locks = new Map<string, string | null>();
    for (const udid of new Set(rows.map((r) => r.device_udid))) {
      const d = await DeviceStoreFactory.getStore().findDevice({ udid });
      locks.set(udid, d?.session_id ?? null);
    }
    const groups = selectOwnActiveGroups(
      rows as any,
      (u) => locks.get(u),
      actor,
      (r) => (r.file_path ? readRecordingTiming(r.file_path)?.groupT0Ms : undefined),
    ).map((g) => ({
      ...g,
      compositeEnabled: fs.existsSync(compositeOutputPath(g.groupId)),
    }));
    return res.json({ serverNow: Date.now(), groups });
  } catch (e: any) {
    recLog.error(`GET /recordings/active failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.post('/recordings/:groupId/annotations/clear', async (req: Request, res: Response) => {
  const parsed = parseClearBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const auth = (req as Request & { auth?: { teamIds?: string[] } }).auth;
  if (seesNone(await visibleRecordings(req.params.groupId, auth?.teamIds))) {
    return res.status(404).json({ error: 'not_found' });
  }
  try {
    const out = await Container.get(RecordingOrchestrator).clearAnnotations(
      req.params.groupId,
      parsed.timecodeMs,
    );
    return res.json(out);
  } catch (e: any) {
    recLog.error(`annotations/clear failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.get('/recordings/:groupId', async (req: Request, res: Response) => {
  try {
    const recs = await Container.get(RecordingStore).listGroup(req.params.groupId);
    // Phase 4A: filter the per-device rows to those whose device is visible
    // to the caller. 404 the whole group if none are visible.
    const auth = (req as Request & { auth?: { teamIds?: string[] } }).auth;
    const visibleRecs = await deviceService.filterRowsByVisibleDevice(
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
 * exists (single-device groups skip composite by design), and for a caller
 * who cannot see every device in it: the composite shows them all.
 */
router.get('/recordings/:groupId/composite.mp4', async (req: Request, res: Response) => {
  const auth = (req as Request & { auth?: { teamIds?: string[] } }).auth;
  const v = await visibleRecordings(req.params.groupId, auth?.teamIds);
  const bundle = Container.get(ProofBundleService);
  if (seesNone(v) || !bundle.compositeAllowed(req.params.groupId, v.ids)) {
    return res.status(404).json({ error: 'composite_not_found' });
  }
  // With the devices' marks burned in when that works, otherwise raw.
  const compositePath = await bundle.resolveCompositeFile(req.params.groupId);
  if (!compositePath) {
    return res.status(404).json({ error: 'composite_not_found' });
  }
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  fs.createReadStream(compositePath).pipe(res);
});

/**
 * Videos-only zip (mp4 files). Prefer this over proof bundle for dashboard
 * downloads — no manifest / bookmarks / device JSON.
 */
router.get('/recordings/:groupId/videos.zip', async (req: Request, res: Response) => {
  const auth = (req as Request & { auth?: { teamIds?: string[] } }).auth;
  const v = await visibleRecordings(req.params.groupId, auth?.teamIds);
  if (seesNone(v)) {
    return res.status(404).json({ error: 'not_found' });
  }
  try {
    const archive = await Container.get(ProofBundleService).buildVideosZip(
      req.params.groupId,
      v.ids,
      v.rows,
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="videos-${req.params.groupId}.zip"`,
    );
    archive.on('error', (err) => {
      recLog.error(`videos.zip stream error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'internal', message: err.message });
      } else {
        res.destroy();
      }
    });
    archive.pipe(res);
  } catch (e: any) {
    if (e?.code === 'no_videos' || e?.message === 'no_videos') {
      return res.status(404).json({ error: 'no_videos', message: 'No playable videos in this group' });
    }
    recLog.error(`videos.zip failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

/**
 * Direct mp4 download. Optional `?udid=` selects a device in a multi-device
 * group; without it, works when the caller can see exactly one playable
 * video in the group. Only devices the caller can see are ever served.
 */
router.get('/recordings/:groupId/video.mp4', async (req: Request, res: Response) => {
  const auth = (req as Request & { auth?: { teamIds?: string[] } }).auth;
  const v = await visibleRecordings(req.params.groupId, auth?.teamIds);
  if (seesNone(v)) {
    return res.status(404).json({ error: 'not_found' });
  }
  const udid = typeof req.query.udid === 'string' ? req.query.udid : undefined;
  try {
    const hit = await Container.get(ProofBundleService).resolveVideoFile(
      req.params.groupId,
      udid,
      v.ids,
      v.rows,
    );
    if (!hit) {
      return res.status(404).json({
        error: 'video_not_found',
        message: udid
          ? 'No playable video for that device'
          : 'Use videos.zip when the group has multiple recordings',
      });
    }
    // res.download sets the attachment disposition and video/mp4, and answers
    // Range requests (206), which a piped read stream never did. The options
    // matter on Appium 3's Express 5: recordings live under ~/.cache, and
    // without `dotfiles: 'allow'` every such path 404s. See DOWNLOAD_OPTIONS.
    res.download(hit.filePath, hit.downloadName, DOWNLOAD_OPTIONS, (err: any) => {
      if (!err || err.code === 'ECONNABORTED') return;
      if (res.headersSent) {
        recLog.warn(`video.mp4 send failed mid-stream: ${err.message}`);
        res.destroy();
        return;
      }
      // Nothing was sent yet: answer JSON, not an empty "attachment", and
      // without the file's validators, which describe the video.
      for (const h of JSON_ERROR_STRIPS) res.removeHeader(h);
      const status = err.status ?? err.statusCode;
      if (status === 404) {
        recLog.warn(`video.mp4 file missing: ${err.message}`);
        res.status(404).json({ error: 'video_not_found' });
      } else if (status === 416) {
        recLog.warn(`video.mp4 range not satisfiable: ${err.message}`);
        // `bytes */<size>` tells the client the length it can ask within.
        const range = err.headers?.['Content-Range'];
        if (range) res.setHeader('Content-Range', range);
        res.status(416).json({ error: 'range_not_satisfiable' });
      } else {
        recLog.error(`video.mp4 send failed: ${err.message}`);
        res.status(500).json({ error: 'internal' });
      }
    });
  } catch (e: any) {
    recLog.error(`video.mp4 failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.get('/recordings/:groupId/bundle.zip', async (req: Request, res: Response) => {
  // 404 if none of the group's devices are visible to the caller; otherwise
  // the bundle carries only the devices they can see.
  const auth = (req as Request & { auth?: { teamIds?: string[] } }).auth;
  const v = await visibleRecordings(req.params.groupId, auth?.teamIds);
  if (seesNone(v)) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="proof-${req.params.groupId}.zip"`,
  );
  const archive = Container.get(ProofBundleService).streamBundleZip(
    req.params.groupId,
    v.ids,
    v.rows,
  );
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
