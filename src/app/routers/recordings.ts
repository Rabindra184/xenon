import { Router, Request, Response } from 'express';
import { Container } from 'typedi';
import * as fs from 'fs';
import * as path from 'path';
import {
  RecordingOrchestrator,
  RecordingError,
  compositeOutputPath,
} from '../../services/recording/RecordingOrchestrator';
import { ProofBundleService } from '../../services/recording/proof-bundle';
import { AnnotationRenderService } from '../../services/recording/annotation-render';
import { RecordingStore } from '../../services/recording/recording-store';
import {
  summarizeGroup,
  buildLibrary,
  type SummaryRow,
  type SummaryContext,
  type Retention,
} from '../../services/recording/recordingSummary';
import * as recordingFiles from '../../services/recording/recordingFiles';
import { roleGuard } from '../../middleware/roleGuard';
import { resolveActor } from '../../services/device-access/actor';
import * as deviceService from '../../data-service/device-service';
import { prisma } from '../../prisma';
import { parseClearBody, parseLibraryQuery } from './recordingRequests';
import { decodeAnnotationImage } from '../../services/recording/annotationImage';
import { selectOwnActiveGroups } from '../../services/recording/activeRecordings';
import { readRecordingTiming } from '../../services/recording/recordingTiming';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { PluginContext } from '../../PluginContext';
import { config } from '../../config';
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
  const visible = await deviceService.filterRowsByVisibleDevice(rows, teamIds, 'device_udid');
  return visible.length > 0;
}

type AuthLike = { teamIds?: string[] };
const authOf = (req: Request) => (req as Request & { auth?: AuthLike }).auth;

/** CleanupService's defaults, so the page's footnote says what the sweep does. */
function retention(): Retention {
  const a = Container.get(PluginContext).pluginArgs ?? {};
  return {
    days: a.recordingCleanupDays ?? 30,
    failedDays: a.recordingFailedCleanupDays ?? 2,
    maxCount: a.recordingCleanupMaxCount ?? 100,
  };
}

function toSummaryRow(r: any): SummaryRow {
  return {
    id: r.id,
    group_id: r.group_id,
    device_udid: r.device_udid,
    status: r.status,
    started_at: new Date(r.started_at),
    ended_at: r.ended_at ? new Date(r.ended_at) : null,
    duration_ms: r.duration_ms ?? null,
    size_bytes: r.size_bytes ?? null,
    fail_reason: r.fail_reason ?? null,
    started_by: r.started_by ?? null,
    timing: r.file_path ? readRecordingTiming(r.file_path) : undefined,
    bookmarkLabels: (r.bookmarks ?? []).map((b: { label: string }) => b.label),
    annotationCount: r._count?.annotations ?? (r.annotations ?? []).length,
  };
}

async function summaryContext(rows: any[]): Promise<SummaryContext> {
  const store = Container.get(RecordingStore);
  const udids = Array.from(new Set(rows.map((r) => r.device_udid as string)));
  const users = Array.from(
    new Set(rows.map((r) => r.started_by as string | null).filter((u): u is string => !!u)),
  );
  return {
    devices: await store.deviceNames(udids),
    users: await store.userNames(users),
    retention: retention(),
    hasComposite: (g) => fs.existsSync(compositeOutputPath(g)),
  };
}

const recLog = log.scope('RecordingsRouter');
const router = Router();
router.use(roleGuard('MEMBER'));

router.get('/recordings', async (req: Request, res: Response) => {
  const parsed = parseLibraryQuery(req.query as Record<string, unknown>);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const rows = await Container.get(RecordingStore).libraryRows();
    const visible = await deviceService.filterRowsByVisibleDevice(
      rows,
      authOf(req)?.teamIds,
      'device_udid',
    );
    const ctx = await summaryContext(visible);
    const page = buildLibrary(visible.map(toSummaryRow), ctx, parsed.filter, {
      limit: parsed.limit,
      cursor: parsed.cursor,
      now: Date.now(),
    });
    return res.json({
      ...page,
      retention: { days: ctx.retention.days, maxCount: ctx.retention.maxCount },
    });
  } catch (e: any) {
    recLog.error(`GET /recordings failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

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
  if (!(await isGroupVisibleToAuth(req.params.groupId, auth?.teamIds))) {
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
    const visibleRecs = await deviceService.filterRowsByVisibleDevice(
      recs,
      authOf(req)?.teamIds,
      'device_udid',
    );
    if (visibleRecs.length === 0) return res.status(404).json({ error: 'not_found' });
    const summary = summarizeGroup(
      visibleRecs.map(toSummaryRow),
      await summaryContext(visibleRecs),
    );
    const bookmarks = visibleRecs
      .reduce<any[]>(
        (acc, r: any) =>
          acc.concat(
            (r.bookmarks ?? []).map((b: any) => ({
              id: b.id,
              recordingId: r.id,
              timecodeMs: b.timecode_ms,
              label: b.label,
              note: b.note ?? null,
            })),
          ),
        [],
      )
      .sort((a, b) => a.timecodeMs - b.timecodeMs);
    const annotations = visibleRecs
      .reduce<any[]>(
        (acc, r: any) =>
          acc.concat(
            (r.annotations ?? []).map((a: any) => ({
              id: a.id,
              recordingId: r.id,
              timecodeMs: a.timecode_ms,
              endTimecodeMs: a.end_timecode_ms ?? null,
              shape: a.shape,
              geometry: a.geometry,
              color: a.color,
              text: a.text ?? null,
            })),
          ),
        [],
      )
      .sort((a, b) => a.timecodeMs - b.timecodeMs);
    return res.json({
      groupId: req.params.groupId,
      recordings: visibleRecs,
      summary,
      bookmarks,
      annotations,
    });
  } catch (e: any) {
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.delete('/recordings/:groupId', async (req: Request, res: Response) => {
  const { groupId } = req.params;
  try {
    const store = Container.get(RecordingStore);
    const recs: any[] = await store.listGroup(groupId);
    const visible = await deviceService.filterRowsByVisibleDevice(
      recs,
      authOf(req)?.teamIds,
      'device_udid',
    );
    if (visible.length === 0) return res.status(404).json({ error: 'not_found' });
    if (recs.some((r) => r.status === 'RECORDING')) {
      return res.status(409).json({
        error: 'recording_in_progress',
        message: 'Stop the recording on Live devices before deleting it.',
      });
    }
    const owner = recs
      .slice()
      .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
      .find((r) => r.started_by)?.started_by;
    const actor = resolveActor(req);
    if (!actor.isAdmin && (!owner || owner !== actor.userId)) {
      return res.status(403).json({
        error: 'not_owner',
        message: 'Only the person who recorded it, or an admin, can delete it.',
      });
    }
    // Rows first: if removing a file fails, no row points at it and the
    // orphan sweep reclaims it; the reverse would leave rows with no videos.
    await store.deleteGroupRows(groupId);
    const removed = recordingFiles.removeRecordingFiles(
      recs.map((r) => r.file_path),
      path.dirname(compositeOutputPath(groupId)),
      config.recordingsAssetsPath,
    );
    recLog.info(
      `Deleted recording ${groupId} (${recs.length} video(s), ${removed.length} dir(s)) for ${actor.userId}`,
    );
    return res.status(204).end();
  } catch (e: any) {
    recLog.error(`DELETE /recordings/:groupId failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
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
  // With the devices' marks burned in when that works, otherwise raw.
  const compositePath = await Container.get(ProofBundleService).resolveCompositeFile(
    req.params.groupId,
  );
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
  if (!(await isGroupVisibleToAuth(req.params.groupId, auth?.teamIds))) {
    return res.status(404).json({ error: 'not_found' });
  }
  try {
    const archive = await Container.get(ProofBundleService).buildVideosZip(req.params.groupId);
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
 * group; without it, works when the group has exactly one playable video.
 */
router.get('/recordings/:groupId/video.mp4', async (req: Request, res: Response) => {
  const auth = (req as Request & { auth?: { teamIds?: string[] } }).auth;
  if (!(await isGroupVisibleToAuth(req.params.groupId, auth?.teamIds))) {
    return res.status(404).json({ error: 'not_found' });
  }
  const udid = typeof req.query.udid === 'string' ? req.query.udid : undefined;
  try {
    const hit = await Container.get(ProofBundleService).resolveVideoFile(
      req.params.groupId,
      udid,
    );
    if (!hit) {
      return res.status(404).json({
        error: 'video_not_found',
        message: udid
          ? 'No playable video for that device'
          : 'Use videos.zip when the group has multiple recordings',
      });
    }
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `attachment; filename="${hit.downloadName}"`);
    fs.createReadStream(hit.filePath).pipe(res);
  } catch (e: any) {
    recLog.error(`video.mp4 failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

/**
 * The clean video, for the recording page's player: no burned-in marks (the
 * page draws them), and Range support so it can seek. `download=1` makes it
 * an attachment — the per-phone "Video" download.
 */
router.get('/recordings/:groupId/source.mp4', async (req: Request, res: Response) => {
  const recordingId = typeof req.query.recordingId === 'string' ? req.query.recordingId : '';
  if (!recordingId) return res.status(400).json({ error: 'recordingId query param is required' });
  try {
    const rec: any = await Container.get(RecordingStore).findById(recordingId);
    if (!rec || rec.group_id !== req.params.groupId)
      return res.status(404).json({ error: 'not_found' });
    const visible = await deviceService.filterRowsByVisibleDevice(
      [rec],
      authOf(req)?.teamIds,
      'device_udid',
    );
    if (visible.length === 0) return res.status(404).json({ error: 'not_found' });
    if (!rec.file_path || !fs.existsSync(rec.file_path)) {
      return res.status(404).json({ error: 'video_not_found' });
    }
    if (req.query.download === '1') {
      const stem = String(rec.device_udid).replace(/[^A-Za-z0-9._-]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${stem}.mp4"`);
    }
    return res.sendFile(
      path.resolve(rec.file_path),
      { headers: { 'Content-Type': 'video/mp4' } },
      (err) => {
        if (err && !res.headersSent)
          res.status(500).json({ error: 'internal', message: err.message });
      },
    );
  } catch (e: any) {
    recLog.error(`source.mp4 failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
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
