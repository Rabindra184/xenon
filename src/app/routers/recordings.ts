import { Router, Request, Response } from 'express';
import { Container } from 'typedi';
import * as fs from 'fs';
import * as path from 'path';
import {
  RecordingOrchestrator,
  RecordingError,
  compositeOutputPath,
} from '../../services/recording/RecordingOrchestrator';
import { ProofBundleService, type RecordingFilter } from '../../services/recording/proof-bundle';
import { AnnotationRenderService } from '../../services/recording/annotation-render';
import { RecordingStore } from '../../services/recording/recording-store';
import { DOWNLOAD_OPTIONS } from './apps';
import {
  summarizeGroup,
  buildLibrary,
  groupOwner,
  type SummaryRow,
  type SummaryContext,
  type Retention,
} from '../../services/recording/recordingSummary';
import * as recordingFiles from '../../services/recording/recordingFiles';
import { roleGuard } from '../../middleware/roleGuard';
import { mutationScopeGuard } from '../../middleware/scopeGuard';
import { resolveActor } from '../../services/device-access/actor';
import * as deviceService from '../../data-service/device-service';
import { parseClearBody, parseLibraryQuery } from './recordingRequests';
import { AUTH_DISABLED_USER_ID } from './profileIdentity';
import { decodeAnnotationImage } from '../../services/recording/annotationImage';
import { selectOwnActiveGroups } from '../../services/recording/activeRecordings';
import { readRecordingTiming } from '../../services/recording/recordingTiming';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { PluginContext } from '../../PluginContext';
import { config } from '../../config';
import log from '../../logger';

type AuthLike = { teamIds?: string[] };
const authOf = (req: Request) => (req as Request & { auth?: AuthLike }).auth;
/** An admin: no team filter, so every row is visible. */
const seesEverything = (req: Request) => authOf(req)?.teamIds === undefined;

interface GroupRow {
  group_id: string;
  device_udid: string;
  started_at: Date | string;
  started_by?: string | null;
}

function byGroupId<T extends { group_id: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  rows.forEach((r) => {
    const list = out.get(r.group_id);
    if (list) list.push(r);
    else out.set(r.group_id, [r]);
  });
  return out;
}

/**
 * The rows of one or more groups the caller may see. Every recording route
 * decides visibility here.
 *
 * - Admins see every row.
 * - Everyone else sees the rows on phones they can see.
 * - The owner of a group also sees the rows they started themselves on a
 *   phone that has no Device row any more: a phone's row is deleted when it is
 *   unplugged, and a missing row reads as invisible, which would otherwise
 *   hide their own recording from them. A phone that still exists but is on
 *   another team stays hidden, even from the owner, and so does a phone
 *   someone else added to their group (add-device checks no team).
 *
 * The owner is decided on every row of a group. `groupRows` supplies them
 * when `rows` is not whole groups; it is read only if some row is hidden.
 */
async function visibleRows<T extends GroupRow>(
  req: Request,
  rows: T[],
  groupRows: () => Promise<GroupRow[]> = async () => rows,
): Promise<T[]> {
  if (seesEverything(req)) return rows;
  const teamIds = authOf(req)?.teamIds;
  const seen = new Set(await deviceService.filterRowsByVisibleDevice(rows, teamIds, 'device_udid'));
  const userId = resolveActor(req).userId;
  const hidden = rows.filter((r) => !seen.has(r));
  if (hidden.length === 0 || !userId) return rows.filter((r) => seen.has(r));
  const owned = new Set<string>();
  byGroupId(await groupRows()).forEach((list, groupId) => {
    if (groupOwner(list) === userId) owned.add(groupId);
  });
  const mine = hidden.filter((r) => owned.has(r.group_id) && r.started_by === userId);
  if (mine.length > 0) {
    const udids = Array.from(new Set(mine.map((r) => r.device_udid)));
    const existing = await Container.get(RecordingStore).deviceNames(udids);
    mine.filter((r) => !existing.has(r.device_udid)).forEach((r) => seen.add(r));
  }
  return rows.filter((r) => seen.has(r));
}

/**
 * The group's recordings this caller may see, by {@link visibleRows}. `ids` is
 * undefined for an admin (no filter). `all` counts the group's rows, so a
 * caller who sees only some phones can be told apart from one who sees them
 * all. `rows` is the group as read here, handed on so a download reads the
 * group only once.
 *
 * A group can mix teams' phones (an admin recorded several teams at once, or a
 * phone moved team afterwards), so a download must carry only these rows:
 * seeing one phone of a group is not seeing the group.
 */
async function visibleRecordings(req: Request, groupId: string) {
  const rows = await Container.get(RecordingStore).listGroup(groupId);
  const visible = await visibleRows(req, rows);
  const ids = seesEverything(req) ? undefined : visible.map((r) => r.id);
  return { rows, all: rows.length, ids };
}
type Visible = Awaited<ReturnType<typeof visibleRecordings>>;
const seesNone = (v: Visible) => v.all === 0 || (v.ids !== undefined && v.ids.length === 0);

/**
 * Headers `send` may already have set for the file, wrong on a JSON error.
 * Not Cache-Control: `send` never sets one over the API-wide `no-store`
 * (src/app/index.ts), so removing it would remove the app's own policy.
 */
const JSON_ERROR_STRIPS = ['Content-Disposition', 'Content-Type', 'ETag', 'Last-Modified'];

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

/** The caller's visible recordings in one group, read leanly; undefined for an admin. */
async function visibleIdsIn(req: Request, groupId: string): Promise<RecordingFilter> {
  if (seesEverything(req)) return undefined;
  const rows = await Container.get(RecordingStore).listGroupStarts(groupId);
  return (await visibleRows(req, rows)).map((r) => r.id);
}

/**
 * Per group, the recordings the caller sees (from {@link visibleRows}), as
 * `ProofBundleService` takes them: undefined, meaning every one, for an admin.
 */
function visibleIdsByGroup(
  req: Request,
  visible: Array<{ id: string; group_id: string }>,
): (groupId: string) => RecordingFilter {
  if (seesEverything(req)) return () => undefined;
  const byGroup = byGroupId(visible);
  return (groupId) => (byGroup.get(groupId) ?? []).map((r) => r.id);
}

/**
 * What the summaries need beyond the visible rows. `all` is every row of the
 * same groups, visible or not: the owner is decided on all of them. The
 * Side-by-side download is offered only to a caller `composite.mp4` would
 * serve, one who sees every phone in its cells.
 */
async function summaryContext(req: Request, all: any[], visible: any[]): Promise<SummaryContext> {
  const store = Container.get(RecordingStore);
  const bundle = Container.get(ProofBundleService);
  const only = visibleIdsByGroup(req, visible);
  const byGroup = byGroupId(all);
  const groupRows = (g: string) => byGroup.get(g) ?? [];
  const udids = Array.from(new Set(visible.map((r) => r.device_udid as string)));
  const groups = Array.from(new Set(visible.map((r) => r.group_id as string)));
  const owners = groups.map((g) => groupOwner(groupRows(g)));
  const users = Array.from(new Set(owners.filter((u): u is string => !!u)));
  const names = await store.userNames(users);
  // An auth-disabled server records everyone as this synthetic user, which
  // has no User row to name it.
  if (users.includes(AUTH_DISABLED_USER_ID)) names.set(AUTH_DISABLED_USER_ID, 'Auth disabled');
  return {
    devices: await store.deviceNames(udids),
    users: names,
    retention: retention(),
    hasComposite: (g) =>
      fs.existsSync(compositeOutputPath(g)) && bundle.compositeAllowed(g, only(g)),
    groupRows,
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
    const visible = await visibleRows(req, rows);
    const ctx = await summaryContext(req, rows, visible);
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
    const rows = await Container.get(RecordingStore).listActiveWithMarks();
    const locks = new Map<string, string | null>();
    for (const udid of new Set(rows.map((r) => r.device_udid))) {
      const d = await DeviceStoreFactory.getStore().findDevice({ udid });
      locks.set(udid, d?.session_id ?? null);
    }
    const own = selectOwnActiveGroups(
      rows as any,
      (u) => locks.get(u),
      actor,
      (r) => (r.file_path ? readRecordingTiming(r.file_path)?.groupT0Ms : undefined),
    );
    // Side-by-side only for a caller composite.mp4 will serve: holding one
    // phone of a group is not seeing every phone in its composite.
    const bundle = Container.get(ProofBundleService);
    const groups = await Promise.all(
      own.map(async (g) => ({
        ...g,
        compositeEnabled:
          fs.existsSync(compositeOutputPath(g.groupId)) &&
          bundle.compositeAllowed(g.groupId, await visibleIdsIn(req, g.groupId)),
      })),
    );
    return res.json({ serverNow: Date.now(), groups });
  } catch (e: any) {
    recLog.error(`GET /recordings/active failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

router.post('/recordings/:groupId/annotations/clear', async (req: Request, res: Response) => {
  const parsed = parseClearBody(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  if (seesNone(await visibleRecordings(req, req.params.groupId))) {
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
    const visibleRecs = await visibleRows(req, recs);
    if (visibleRecs.length === 0) return res.status(404).json({ error: 'not_found' });
    const summary = summarizeGroup(
      visibleRecs.map(toSummaryRow),
      await summaryContext(req, recs, visibleRecs),
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
    recLog.error(`GET /recordings/:groupId failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

// Irreversible, so an API key needs `devices`, as on /control: owning the
// recording, or an admin role, is not enough for a read-only key.
const devicesScope = mutationScopeGuard(['devices']);
router.delete('/recordings/:groupId', devicesScope, async (req: Request, res: Response) => {
  const { groupId } = req.params;
  try {
    const store = Container.get(RecordingStore);
    const recs: any[] = await store.listGroup(groupId);
    const visible = await visibleRows(req, recs);
    if (visible.length === 0) return res.status(404).json({ error: 'not_found' });
    if (recs.some((r) => r.status === 'RECORDING')) {
      return res.status(409).json({
        error: 'recording_in_progress',
        message: 'Stop the recording on Live devices before deleting it.',
      });
    }
    const owner = groupOwner(recs);
    const actor = resolveActor(req);
    if (!actor.isAdmin && (!owner || owner !== actor.userId)) {
      return res.status(403).json({
        error: 'not_owner',
        message: 'Only the person who recorded it, or an admin, can delete it.',
      });
    }
    // Only what the caller can see: a phone on another team stays with that
    // team, and so does the composite, which shows it, until no row of the
    // group is left. An admin sees every row, so deletes the whole group.
    // Rows first: if removing a file fails, no row points at it and the
    // orphan sweep reclaims it; the reverse would leave rows with no videos.
    await store.deleteGroupRows(
      groupId,
      visible.map((r) => r.id),
    );
    const left = (await store.listGroupStarts(groupId)).length;
    const removed = recordingFiles.removeRecordingFiles(
      visible.map((r) => r.file_path),
      left === 0 ? path.dirname(compositeOutputPath(groupId)) : null,
      config.recordingsAssetsPath,
    );
    recLog.info(
      `Deleted ${visible.length} of ${recs.length} video(s) of recording ${groupId} (${removed.length} dir(s), ${left} left) for ${actor.userId}`,
    );
    return res.status(204).end();
  } catch (e: any) {
    recLog.error(`DELETE /recordings/:groupId failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

/**
 * Stream the mosaic-wide composite mp4 for a group. 404s when no composite
 * exists (single-device groups skip composite by design), and for a caller
 * who cannot see every device in it: the composite shows them all.
 */
router.get('/recordings/:groupId/composite.mp4', async (req: Request, res: Response) => {
  const v = await visibleRecordings(req, req.params.groupId);
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
  const v = await visibleRecordings(req, req.params.groupId);
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
 * The one error callback for a video sent with `res.download` / `sendFile`.
 * `send` reports a failure here with the real HTTP status on `err.status`:
 * 404 when the file vanished after we found it (a concurrent DELETE, or the
 * cleanup sweep), 416 for an unsatisfiable Range. By then it has usually set
 * the file's `Content-Type`, validators and (for a download) disposition,
 * which are wrong on a JSON error. Left alone, every such failure became a 500
 * that still carried `Content-Type: video/mp4` on a JSON body.
 */
function handleSendError(what: string, req: Request, res: Response, err: any): void {
  if (!err) return;
  // The client is already gone: writing to the socket would throw, and
  // there is nobody left to read a response anyway.
  if (err.code === 'ECONNABORTED' || req.aborted) return;
  if (res.headersSent) {
    recLog.warn(`${what} send failed mid-stream: ${err.message}`);
    if (!res.destroyed) res.destroy();
    return;
  }
  // Nothing was sent yet: answer JSON, not an empty "attachment", and
  // without the file's validators, which describe the video.
  for (const h of JSON_ERROR_STRIPS) res.removeHeader(h);
  const status = err.status ?? err.statusCode;
  if (status === 404) {
    recLog.warn(`${what} file missing: ${err.message}`);
    res.status(404).json({ error: 'video_not_found' });
  } else if (status === 416) {
    recLog.warn(`${what} range not satisfiable: ${err.message}`);
    // `bytes */<size>` tells the client the length it can ask within.
    const range = err.headers?.['Content-Range'];
    if (range) res.setHeader('Content-Range', range);
    res.status(416).json({ error: 'range_not_satisfiable' });
  } else {
    recLog.error(`${what} send failed: ${err.message}`);
    res.status(500).json({ error: 'internal' });
  }
}

/**
 * Direct mp4 download. Optional `?udid=` selects a device in a multi-device
 * group; without it, works when the caller can see exactly one playable
 * video in the group. Only devices the caller can see are ever served.
 */
router.get('/recordings/:groupId/video.mp4', async (req: Request, res: Response) => {
  const v = await visibleRecordings(req, req.params.groupId);
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
    res.download(hit.filePath, hit.downloadName, DOWNLOAD_OPTIONS, (err: any) =>
      handleSendError('video.mp4', req, res, err),
    );
  } catch (e: any) {
    recLog.error(`video.mp4 failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
});

/**
 * The clean video, for the recording page's player: no burned-in marks (the
 * page draws them), and Range support so it can seek. `download=1` makes it
 * an attachment — the per-phone "Video" download.
 *
 * Exported (rather than an inline handler) so a test can call it directly
 * with a fake `res` and assert on the options handed to `sendFile`, the way
 * `apps.ts`'s `downloadApp` does — a supertest run stays on this repo's
 * Express 4 dev-dependency, which can't reproduce the Express 5 bug below.
 */
export async function sourceMp4Handler(req: Request, res: Response) {
  const recordingId = typeof req.query.recordingId === 'string' ? req.query.recordingId : '';
  if (!recordingId) return res.status(400).json({ error: 'recordingId query param is required' });
  try {
    const store = Container.get(RecordingStore);
    const rec: any = await store.findById(recordingId);
    if (!rec || rec.group_id !== req.params.groupId)
      return res.status(404).json({ error: 'not_found' });
    // One recording, not the whole group with its marks: the player asks for
    // a range many times. The group is read, leanly, only to name its owner.
    const visible = await visibleRows(req, [rec], () => store.listGroupStarts(rec.group_id));
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
      {
        // Recordings live under `~/.cache/xenon/...` (config.ts), and `.cache`
        // is a dot-segment. Appium 3's Express 5 `send` 1.2.x defaults
        // `dotfiles` to `ignore` and refuses any path with a dot segment
        // ANYWHERE in it, unlike Express 4's `send` 0.19, which only looked at
        // the last segment — so every real recording 500'd. `DOWNLOAD_OPTIONS`
        // (`apps.ts`) is safe here for the same reason it is there: the path
        // comes from the DB row `findById` looked up, never from the request.
        ...DOWNLOAD_OPTIONS,
        headers: { 'Content-Type': 'video/mp4' },
      },
      (err: any) => handleSendError('source.mp4', req, res, err),
    );
  } catch (e: any) {
    recLog.error(`source.mp4 failed: ${e?.message}`);
    return res.status(500).json({ error: 'internal', message: e?.message });
  }
}

router.get('/recordings/:groupId/source.mp4', sourceMp4Handler);

router.get('/recordings/:groupId/bundle.zip', async (req: Request, res: Response) => {
  // 404 if none of the group's devices are visible to the caller; otherwise
  // the bundle carries only the devices they can see.
  const v = await visibleRecordings(req, req.params.groupId);
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

/** One phone's video with its marks burned in: the Download menu's "video with annotations". */
router.get('/recordings/:groupId/exports/annotated.mp4', async (req: Request, res: Response) => {
  const recordingId = String(req.query.recordingId ?? '');
  if (!recordingId) {
    return res.status(400).json({ error: 'recordingId query param is required' });
  }
  try {
    const store = Container.get(RecordingStore);
    const rec: any = await store.findById(recordingId);
    if (!rec || rec.group_id !== req.params.groupId) {
      return res.status(404).json({ error: 'not_found' });
    }
    const visible = await visibleRows(req, [rec], () => store.listGroupStarts(rec.group_id));
    if (visible.length === 0) return res.status(404).json({ error: 'not_found' });
    const { stream, cleanup } =
      await Container.get(AnnotationRenderService).renderForRecording(recordingId);
    res.setHeader('Content-Type', 'video/mp4');
    stream.pipe(res);
    res.on('close', cleanup);
    stream.on('end', cleanup);
  } catch (e: any) {
    recLog.error(`annotated.mp4 render failed: ${e?.message}`);
    res.status(500).json({ error: 'render_failed', message: e?.message });
  }
});

function register(parentRouter: Router) {
  parentRouter.use('/', router);
}

export default { register };
