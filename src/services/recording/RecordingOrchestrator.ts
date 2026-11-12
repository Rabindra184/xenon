import { Service, Container } from 'typedi';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { trace, metrics, SpanStatusCode, Counter, Histogram, Span } from '@opentelemetry/api';
import { VideoPipelineService, type CompositeGeometry } from '../VideoPipelineService';
import { DashboardEventManager } from '../../dashboard/event-manager';
import { BusyPrecheck, BusyEntry } from './busy-precheck';
import { RecordingStore } from './recording-store';
import { ConcurrencyGate } from './concurrency-gate';
import {
  blockDevice as defaultBlockDevice,
  unblockDevice as defaultUnblockDevice,
} from '../../data-service/device-service';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { holdsClaim } from '../../data-service/deviceClaims';
import { prisma } from '../../prisma';
import { formatManualLock } from './manualLock';
import type { ObservedPhone } from './observerSessions';
import { recordingSourceFor, type RecordingSource } from './nodeRecordingSource';
import { ensureMjpegForRecording } from './ensureMjpegForRecording';
import { probeVideoDurationMs } from './probeDuration';
import { annotationImagePath } from './annotationImage';
import { readRecordingTiming, writeRecordingTiming } from './recordingTiming';
import { ATTR, METRIC, OUTCOME } from '../telemetry/attributes';
import log from '../../logger';
import { ARTIFACT_STORE } from '../artifacts/ArtifactStore';
import type { ArtifactStore } from '../artifacts/ArtifactStore';

const recLog = log.scope('RecordingOrchestrator');

/** Below this size after stop, treat the mp4 as empty/corrupt. */
const MIN_PLAYABLE_MP4_BYTES = 1024;

/** How often an observer group checks that its phones' claims still name its sessions. */
const OBSERVER_CHECK_MS = 10_000;

/** Observer group ids remembered after they stop, so add-device still refuses them. */
const OBSERVER_GROUPS_REMEMBERED = 1_000;

// Lazy-init OTel instruments. Module-load order vs. TracingService init does
// not matter — the OTel API returns Noop instruments until a real
// MeterProvider is registered.
let otelLoaded = false;
let attemptsCounter: Counter;
let failuresCounter: Counter;
let compositeFailuresCounter: Counter;
let durationHistogram: Histogram;
let deviceCountHistogram: Histogram;

function ensureOtelInstruments() {
  if (otelLoaded) return;
  const meter = metrics.getMeter('xenon.recording');
  attemptsCounter = meter.createCounter(METRIC.RECORDING_ATTEMPTS, {
    description: 'Number of recording group start / addDevice attempts.',
  });
  failuresCounter = meter.createCounter(METRIC.RECORDING_FAILURES, {
    description: 'Recording attempts that failed, labeled by fail_reason.',
  });
  compositeFailuresCounter = meter.createCounter(METRIC.RECORDING_COMPOSITE_FAILURES, {
    description:
      'Composite (mosaic mp4) ffmpeg failures. Non-fatal — per-device recordings continue.',
  });
  durationHistogram = meter.createHistogram(METRIC.RECORDING_DURATION_MS, {
    description: 'Per-recording duration on stop, labeled by outcome.',
    unit: 'ms',
  });
  deviceCountHistogram = meter.createHistogram(METRIC.RECORDING_DEVICE_COUNT, {
    description: 'Number of devices in a recording group at start time.',
  });
  otelLoaded = true;
}

/**
 * Canonical on-disk location for a group's composite mp4. Kept as a single
 * helper so the router, bundle, and orchestrator all agree on the path
 * without needing a schema column. Sits in a `_groups/<groupId>` subtree to
 * stay clear of per-recording-id folders.
 */
export function compositeOutputPath(groupId: string): string {
  return (Container.get(ARTIFACT_STORE) as ArtifactStore).resolve(
    '_groups',
    groupId,
    'composite.mp4',
  );
}

/** Which recording sits in which composite cell, beside the composite. */
export function compositeLayoutPath(groupId: string): string {
  return path.join(path.dirname(compositeOutputPath(groupId)), 'composite.json');
}

export interface CompositeLayoutFile {
  version: 1;
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  cells: Array<{ index: number; udid: string; recordingId: string }>;
}

export class RecordingError extends Error {
  constructor(
    public readonly code: 'device_busy' | 'concurrency_cap' | 'observer_group',
    public readonly busyDevices?: BusyEntry[],
    public readonly limit?: number,
    public readonly active?: number,
  ) {
    super(code);
  }
}

export interface StartInput {
  udids: string[];
  sessionId?: string;
  /**
   * Observer mode (ENH-06): the caller's own Appium sessions and the phones
   * they run on, one per udid, in the same order as `udids`. The recording
   * holds nothing on those phones, and the whole group stops as soon as any of
   * the sessions ends (sessionEnded, or the claim check every
   * observerCheckMs).
   */
  observe?: ObservedPhone[];
  note?: string;
  /**
   * Identity of the dashboard caller (api-key id). Embedded in every manual
   * lock acquired by this recording so other users / sessions can recognise
   * "this is mine" vs "this is someone else's". Required for the multi-user
   * safety model.
   */
  actorId: string;
}

export interface StartedRecording {
  id: string;
  udid: string;
  status: string;
  /** The session an observer recording films. */
  sessionId?: string;
}

export interface BlockDeviceFn {
  (udid: string, host: string, sessionId?: string): Promise<void>;
}
export interface UnblockDeviceFn {
  (udid: string, host: string): Promise<void>;
}

/**
 * The live preview's leave path, as a page that stops watching uses it: after
 * a short grace, the phone's preview is stopped and its hold released unless
 * someone watches it or another recording reads it. Imported when called:
 * control.ts is a router, loaded long after this service.
 */
function leaveDevice(udid: string): void {
  void import('../../app/routers/control')
    .then(({ previewLeaves }) => previewLeaves.leave(udid))
    .catch((err: any) => {
      recLog.warn(`Could not hand ${udid} to the preview's leave path: ${err?.message ?? err}`);
    });
}

export interface OrchestratorDeps {
  busyPrecheck?: BusyPrecheck;
  store?: RecordingStore;
  gate?: ConcurrencyGate;
  videoPipeline?: VideoPipelineService;
  blockDeviceFn?: BlockDeviceFn;
  eventMgr?: DashboardEventManager;
  unblockDeviceFn?: UnblockDeviceFn;
  /**
   * Resolves a live MJPEG loopback port before ffmpeg starts. Injected in
   * unit tests so stream services need not be registered in the DI container.
   */
  ensureMjpegPortFn?: (udid: string) => Promise<number>;
  /**
   * For another server's phone (a node's, on a hub), a loopback relay to its
   * node's stream, read in place of ensureMjpegPortFn's port; null for this
   * server's own phone. See nodeRecordingSource.ts.
   */
  nodeSourceFn?: (udid: string, actorId: string) => Promise<RecordingSource | null>;
  /**
   * Reads how long the finished mp4 actually is. Injected in unit tests so
   * finalizing a recording never spawns ffmpeg.
   */
  probeDurationMsFn?: (filePath: string) => Promise<number | undefined>;
  /**
   * Hands a phone whose recording has ended to the live preview's leave path
   * (control.ts previewLeaves), which releases its hold once nobody watches
   * it. Injected in unit tests.
   */
  leaveDeviceFn?: (udid: string) => void;
  /** Wall clock for recording timings. Injected in unit tests. */
  now?: () => number;
  /**
   * Whether the Session row exists. Recording.session_id is a foreign key, so
   * an observer recording writes it only then: a local session with the
   * dashboard off has no row.
   */
  sessionRowExistsFn?: (sessionId: string) => Promise<boolean>;
  /** Whether the phone's claim still names the session (deviceClaims.ts holdsClaim). */
  claimHoldsFn?: (udid: string, sessionId: string) => Promise<boolean>;
  /** How often an observer group checks its phones' claims. */
  observerCheckMs?: number;
}

/** A lookup that fails counts as no row: the recording goes on without the link. */
async function sessionRowExists(sessionId: string): Promise<boolean> {
  try {
    const row = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    return row !== null;
  } catch (err: any) {
    recLog.debug(`Session row lookup for ${sessionId} failed: ${err?.message ?? err}`);
    return false;
  }
}

/**
 * A lookup that fails counts as still held: a store hiccup must not stop a
 * recording. The next check, or the session's own ending, decides.
 */
async function claimHolds(udid: string, sessionId: string): Promise<boolean> {
  try {
    const rows = await DeviceStoreFactory.getStore().findDevices({ udid });
    return rows.some((row) => holdsClaim(row, { sessionId }));
  } catch (err: any) {
    recLog.debug(`Claim lookup for ${udid} (${sessionId}) failed: ${err?.message ?? err}`);
    return true;
  }
}

/** An observer group while it records: its phones, and the timer that checks their claims. */
interface ObserverGroup {
  sessions: ObservedPhone[];
  timer: NodeJS.Timeout;
  /** A check is running; the next tick doesn't start another. */
  checking: boolean;
}

/** An observer start still being built: the endings of its sessions that arrived meanwhile. */
interface PendingObserverStart {
  sessionIds: Set<string>;
  ended: boolean;
}

@Service()
export class RecordingOrchestrator {
  // All deps are public so tests can rebind a single one without rebuilding.
  public unblockDeviceFn: UnblockDeviceFn;
  public blockDeviceFn: BlockDeviceFn;
  public ensureMjpegPortFn: (udid: string) => Promise<number>;
  public nodeSourceFn: (udid: string, actorId: string) => Promise<RecordingSource | null>;
  public probeDurationMsFn: (filePath: string) => Promise<number | undefined>;
  public leaveDeviceFn: (udid: string) => void;
  public now: () => number;
  public sessionRowExistsFn: (sessionId: string) => Promise<boolean>;
  public claimHoldsFn: (udid: string, sessionId: string) => Promise<boolean>;
  private readonly observerCheckMs: number;
  private readonly _deps: Required<
    Omit<
      OrchestratorDeps,
      | 'blockDeviceFn'
      | 'unblockDeviceFn'
      | 'ensureMjpegPortFn'
      | 'nodeSourceFn'
      | 'probeDurationMsFn'
      | 'leaveDeviceFn'
      | 'now'
      | 'sessionRowExistsFn'
      | 'claimHoldsFn'
      | 'observerCheckMs'
    >
  >;
  /**
   * Recording ids currently being closed out. Both the user-initiated stop and
   * an ffmpeg self-exit finalize rows, and they can land at the same instant —
   * this keeps exactly one of them doing it.
   */
  private readonly finalizing = new Set<string>();
  /** The relays node phones' recordings read, by recording id, until finalized. */
  private readonly nodeSources = new Map<string, RecordingSource>();
  /** Observer groups still recording, by group id. */
  private readonly observerGroups = new Map<string, ObserverGroup>();
  /** Which observer group films each session, by session id. */
  private readonly observedBy = new Map<string, string>();
  /** Observer starts not yet registered, so an ending during one is not lost. */
  private readonly pendingObserverStarts = new Set<PendingObserverStart>();
  /** Recording ids of observer recordings not yet finalized: they let go of nothing. */
  private readonly observerRecordings = new Set<string>();
  /** Every observer group id, stopped ones included (the newest 1,000), for add-device. */
  private readonly observerGroupIds = new Set<string>();

  constructor(deps: OrchestratorDeps = {}) {
    this._deps = {
      busyPrecheck: deps.busyPrecheck ?? Container.get(BusyPrecheck),
      store: deps.store ?? Container.get(RecordingStore),
      gate: deps.gate ?? Container.get(ConcurrencyGate),
      videoPipeline: deps.videoPipeline ?? Container.get(VideoPipelineService),
      eventMgr: deps.eventMgr ?? Container.get(DashboardEventManager),
    };
    this.blockDeviceFn = deps.blockDeviceFn ?? defaultBlockDevice;
    this.unblockDeviceFn = deps.unblockDeviceFn ?? defaultUnblockDevice;
    this.ensureMjpegPortFn = deps.ensureMjpegPortFn ?? ensureMjpegForRecording;
    this.nodeSourceFn = deps.nodeSourceFn ?? ((udid, actorId) => recordingSourceFor(udid, actorId));
    this.probeDurationMsFn = deps.probeDurationMsFn ?? probeVideoDurationMs;
    this.leaveDeviceFn = deps.leaveDeviceFn ?? leaveDevice;
    this.now = deps.now ?? Date.now;
    this.sessionRowExistsFn = deps.sessionRowExistsFn ?? sessionRowExists;
    this.claimHoldsFn = deps.claimHoldsFn ?? claimHolds;
    this.observerCheckMs = deps.observerCheckMs ?? OBSERVER_CHECK_MS;
  }

  private get busyPrecheck() {
    return this._deps.busyPrecheck;
  }
  private get store() {
    return this._deps.store;
  }
  private get gate() {
    return this._deps.gate;
  }
  private get videoPipeline() {
    return this._deps.videoPipeline;
  }
  private get eventMgr() {
    return this._deps.eventMgr;
  }

  /**
   * Start a recording group. Atomic — if any UDID is busy or the cap would be
   * exceeded, no rows are written, no ffmpeg is spawned, no manual blocks are
   * taken.
   */
  async start(input: StartInput): Promise<{
    groupId: string;
    recordings: StartedRecording[];
    startedAt: Date;
    compositeEnabled: boolean;
  }> {
    ensureOtelInstruments();
    const { udids, actorId } = input;
    if (!actorId) {
      throw new Error('RecordingOrchestrator.start: actorId is required');
    }

    const span = trace.getTracer('xenon.recording').startSpan('xenon.recording.start', {
      attributes: { [ATTR.RECORDING_DEVICE_COUNT]: udids.length },
    });
    attemptsCounter.add(1);
    deviceCountHistogram.record(udids.length);

    try {
      const result = await this._startInternal(input, span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err: any) {
      const failReason = err instanceof RecordingError ? err.code : (err?.message ?? 'unknown');
      failuresCounter.add(1, { fail_reason: failReason });
      span.setAttributes({ [ATTR.RECORDING_FAIL_REASON]: failReason });
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: failReason });
      throw err;
    } finally {
      span.end();
    }
  }

  private async _startInternal(
    input: StartInput,
    span: Span,
  ): Promise<{
    groupId: string;
    recordings: StartedRecording[];
    startedAt: Date;
    compositeEnabled: boolean;
  }> {
    const { udids, observe } = input;
    if (!observe) return this.buildGroup(input, span);
    if (observe.length !== udids.length || observe.some((p, i) => p.udid !== udids[i])) {
      throw new Error('RecordingOrchestrator.start: udids must be the observed phones');
    }
    // A session can end while its group is being built, before sessionEnded
    // can find the group. Its ending is noted here and acted on once the
    // group exists.
    const pending: PendingObserverStart = {
      sessionIds: new Set(observe.map((p) => p.sessionId)),
      ended: false,
    };
    this.pendingObserverStarts.add(pending);
    let out: Awaited<ReturnType<RecordingOrchestrator['buildGroup']>>;
    try {
      out = await this.buildGroup(input, span);
    } finally {
      this.pendingObserverStarts.delete(pending);
    }
    // Registered in the same step as the pending entry goes, so no ending
    // falls between the two.
    this.watchObserverGroup(out.groupId, observe, out.recordings.length > 0);
    if (pending.ended) {
      recLog.info(`Observer group ${out.groupId}: a session ended while it started; stopping it.`);
      await this.stop(out.groupId, { failReason: 'session_ended' });
    } else {
      // A session that ended before the start began (between the route's
      // lookup and here) left no ending to note: its phone's claim says so.
      await this.checkObserverGroup(out.groupId);
    }
    return out;
  }

  private async buildGroup(
    input: StartInput,
    span: Span,
  ): Promise<{
    groupId: string;
    recordings: StartedRecording[];
    startedAt: Date;
    compositeEnabled: boolean;
  }> {
    const { udids, sessionId, actorId, observe } = input;
    const observed = observe ? new Map(observe.map((p) => [p.udid, p] as const)) : undefined;

    // Layer 2 atomic pre-check: busy state. An observed phone's own session
    // is no conflict: recording it is the point.
    const busy = observed
      ? await this.busyPrecheck.findBusy(
          udids,
          actorId,
          undefined,
          new Map(observe!.map((p) => [p.udid, p.sessionId])),
        )
      : await this.busyPrecheck.findBusy(udids, actorId);
    if (busy.length > 0) {
      throw new RecordingError('device_busy', busy);
    }

    // Pre-allocate ids and reserve cap slots atomically.
    const recordingIds = udids.map(() => uuidv4());
    if (!this.gate.tryAcquire(recordingIds)) {
      throw new RecordingError(
        'concurrency_cap',
        undefined,
        this.gate.getLimit(),
        this.gate.activeCount(),
      );
    }

    const groupId = uuidv4();
    span.setAttributes({ [ATTR.RECORDING_GROUP_ID]: groupId });
    const startedAt = new Date();
    const acquiredBlocks: Array<{ udid: string; host: string }> = [];

    // Look up host for each device (needed for block/unblock). An observed
    // phone's is the row its session's claim was found on.
    const deviceHosts: Record<string, string> = {};
    try {
      for (const udid of udids) {
        if (observed) {
          deviceHosts[udid] = observed.get(udid)!.host;
          continue;
        }
        const dev = await DeviceStoreFactory.getStore().findDevice({ udid });
        deviceHosts[udid] = dev?.host ?? '127.0.0.1';
      }
    } catch (err: any) {
      // If device lookup fails, abort cleanly.
      for (const id of recordingIds) this.gate.release(id);
      throw new RecordingError('device_busy', [{ udid: 'unknown', reason: 'unknown' }]);
    }

    // Take manual blocks transactionally. If any fails, roll back. An
    // observer recording holds nothing: the phone is its session's.
    try {
      for (const udid of observed ? [] : udids) {
        const host = deviceHosts[udid];
        await this.blockDeviceFn(udid, host, formatManualLock(actorId, udid));
        acquiredBlocks.push({ udid, host });
      }
    } catch (err: any) {
      recLog.warn(`Block acquisition failed mid-flight: ${err?.message}`);
      for (const a of acquiredBlocks) {
        await this.tryUnblock(a.udid, a.host);
      }
      for (const id of recordingIds) this.gate.release(id);
      throw new RecordingError('device_busy', [{ udid: 'unknown', reason: 'unknown' }]);
    }

    // Create rows and spawn ffmpeg per device. MJPEG must be live first —
    // Android H.264 preview does not open an MJPEG port.
    const recordings: StartedRecording[] = [];
    const mjpegPorts: Record<string, number> = {};
    const spawned: Array<{ filePath: string; spawnedAtMs: number }> = [];
    for (let i = 0; i < udids.length; i++) {
      const id = recordingIds[i];
      const udid = udids[i];
      const host = deviceHosts[udid];
      const filePath = (Container.get(ARTIFACT_STORE) as ArtifactStore).resolve(
        id,
        'video',
        `${id}.mp4`,
      );
      const watched = observed?.get(udid);
      // Before anything can finalize it (its ffmpeg may exit at once).
      if (watched) this.observerRecordings.add(id);
      try {
        const mjpegPort = await this.sourcePort(id, udid, actorId);
        mjpegPorts[udid] = mjpegPort;
        // Recording.session_id is a foreign key: an observed session's id is
        // written only when its Session row exists.
        const rowSessionId = watched
          ? (await this.sessionRowExistsFn(watched.sessionId).catch(() => false))
            ? watched.sessionId
            : null
          : (sessionId ?? null);
        await this.store.create({
          id,
          groupId,
          deviceUdid: udid,
          deviceHost: host,
          filePath,
          sessionId: rowSessionId,
          deviceSnapshot: null,
          startedBy: actorId,
        });
        await this.videoPipeline.startRecording({
          sessionId: id,
          udid,
          outputPath: filePath,
          mjpegPort,
          // ffmpeg can end before anyone presses Stop — most often because the
          // device stopped answering and the MJPEG server disconnected it.
          onExit: (code) => void this.handleSourceEnded(id, code),
        });
        // startRecording resolves as its ffmpeg spawns: this video's t=0.
        spawned.push({ filePath, spawnedAtMs: this.now() });
        recordings.push(
          watched
            ? { id, udid, status: 'RECORDING', sessionId: watched.sessionId }
            : { id, udid, status: 'RECORDING' },
        );
      } catch (err: any) {
        recLog.error(`Failed to start recording for ${udid}: ${err?.message}`);
        this.observerRecordings.delete(id);
        await this.closeNodeSource(id);
        // Mark this one failed but continue with the rest of the group.
        try {
          await this.store.finalize(id, {
            status: 'FAILED',
            failReason: err?.message ?? 'spawn_failed',
          });
        } catch {
          /* ignore */
        }
        this.gate.release(id);
        if (!watched) await this.tryUnblock(udid, host);
        this.eventMgr.emitRecordingFailed({
          groupId,
          recordingId: id,
          udid,
          reason: err?.message ?? 'spawn_failed',
        });
        // Per-device spawn failure is non-fatal at the group level — the rest
        // of the devices keep recording — but we still want a failure tick so
        // dashboards can surface flaky devices.
        failuresCounter.add(1, { fail_reason: 'spawn_failed' });
        span.addEvent('device_spawn_failed', { udid, reason: err?.message ?? 'spawn_failed' });
      }
    }

    // Mosaic composite: one mp4 with all devices side-by-side. Skipped for
    // single-device groups (the per-device mp4 IS the "whole screen").
    let compositeEnabled = false;
    if (recordings.length >= 2) {
      try {
        const compositeInputs: { mjpegPort: number; udid: string }[] = [];
        for (const r of recordings) {
          const port =
            mjpegPorts[r.udid] ??
            (await DeviceStoreFactory.getStore().findDevice({ udid: r.udid }))?.mjpegServerPort;
          if (port) {
            compositeInputs.push({ udid: r.udid, mjpegPort: port });
          }
        }
        if (compositeInputs.length >= 2) {
          const compositePath = compositeOutputPath(groupId);
          const geometry = await this.videoPipeline.startComposite({
            groupId,
            inputs: compositeInputs,
            outputPath: compositePath,
          });
          recLog.info(`Composite recording started for group ${groupId} → ${compositePath}`);
          compositeEnabled = true;
          this.writeCompositeLayout(groupId, geometry, compositeInputs, recordings);
        } else {
          recLog.warn(
            `Composite skipped for group ${groupId}: not enough MJPEG ports resolved (${compositeInputs.length}/${recordings.length}).`,
          );
          span.addEvent('composite_skipped', {
            resolved_inputs: compositeInputs.length,
            recordings: recordings.length,
          });
        }
      } catch (err: any) {
        // Composite failure is non-fatal — per-device recordings continue.
        recLog.warn(`Composite start failed for group ${groupId}: ${err?.message}`);
        compositeFailuresCounter.add(1);
        span.addEvent('composite_failed', { reason: err?.message ?? 'unknown' });
      }
    }
    span.setAttributes({ [ATTR.RECORDING_COMPOSITE_ENABLED]: compositeEnabled });

    this.eventMgr.emitRecordingStarted({
      groupId,
      recordings: recordings.map((r) => ({ id: r.id, udid: r.udid })),
      startedAt,
    });
    // The dashboard stamps its t=0 when this returns, and every mark's
    // timecode counts from it. The per-device videos started earlier.
    const groupT0Ms = this.now();
    for (const s of spawned) this.recordTiming(s.filePath, s.spawnedAtMs, groupT0Ms);
    return { groupId, recordings, startedAt, compositeEnabled };
  }

  /**
   * Close out one recording: stop its ffmpeg, size the file, decide the terminal
   * status, persist it, release the gate slot and the device lock, and record
   * the metrics. Shared by the user-initiated stop path and by
   * handleSourceEnded, so the two can never drift.
   *
   * `failReason` says why a recording that still stops cleanly ended
   * (`session_ended` for an observer group); a FAILED one keeps its own.
   * An observer recording lets go of nothing: it never held the phone.
   */
  private async finalizeRecording(
    r: any,
    opts: { endedBySource?: boolean; failReason?: string } = {},
  ): Promise<{
    id: string;
    udid: string;
    status: string;
    durationMs?: number;
    sizeBytes?: number;
  }> {
    // Both entry points land here and this is where the instruments are used;
    // handleSourceEnded has no reason to know they are lazily created.
    ensureOtelInstruments();
    let status: 'STOPPED' | 'FAILED' = 'STOPPED';
    let failReason: string | undefined;
    try {
      await this.videoPipeline.stopRecording(r.id);
    } catch (err: any) {
      status = 'FAILED';
      failReason = err?.message ?? 'ffmpeg_stop_failed';
    }
    // Its ffmpeg is done reading; a group's composite stops before this.
    const fromNode = this.nodeSources.has(r.id);
    await this.closeNodeSource(r.id);
    // How long the video actually is, not how long the session was open. Those
    // agree only while capture keeps up: a recording whose device died at 26s
    // and was stopped 5 minutes later reported 5m36s for a 35s file (#204).
    // Wall-clock is not lost — started_at and ended_at are both persisted, so
    // it stays derivable, while the media duration is not recoverable later
    // without re-reading the file. Probed after stopRecording so the faststart
    // remux has happened and the header carries a duration; falls back to
    // wall-clock whenever the probe can't answer.
    const wallClockMs = r.started_at ? Date.now() - new Date(r.started_at).getTime() : undefined;
    let durationMs = wallClockMs;
    try {
      const probed = await this.probeDurationMsFn(r.file_path);
      if (probed !== undefined) durationMs = probed;
    } catch (err: any) {
      recLog.debug(`duration probe failed for ${r.id}, using wall-clock: ${err?.message ?? err}`);
    }
    let sizeBytes: number | undefined;
    try {
      sizeBytes = fs.statSync(r.file_path).size;
    } catch {
      // File may not exist on FAIL; leave size undefined.
    }
    if (status === 'STOPPED' && (sizeBytes === undefined || sizeBytes < MIN_PLAYABLE_MP4_BYTES)) {
      status = 'FAILED';
      failReason = 'empty_or_corrupt_mp4';
      recLog.warn(
        `Recording ${r.id} for ${r.device_udid} produced unusable file ` +
          `(size=${sizeBytes ?? 'missing'} bytes)`,
      );
    }
    // A recording whose source ended still produced valid video — just less of
    // it than was asked for. Keeping it STOPPED leaves the mp4 downloadable;
    // recording why it ended keeps "this is shorter than you expected" visible
    // in the data rather than only in the log.
    if (opts.endedBySource && status === 'STOPPED') {
      failReason = 'source_ended';
    } else if (opts.failReason && status === 'STOPPED') {
      failReason = opts.failReason;
    }
    try {
      await this.store.finalize(r.id, { status, durationMs, sizeBytes, failReason });
    } catch (err: any) {
      recLog.warn(`finalize failed for ${r.id}: ${err?.message}`);
    }
    this.gate.release(r.id);
    const observer = this.observerRecordings.delete(r.id);
    if (!observer) {
      await this.letGoOfDevice(r.device_udid, r.device_host ?? '127.0.0.1', fromNode);
    }
    if (durationMs !== undefined) {
      durationHistogram.record(durationMs, {
        outcome: status === 'STOPPED' ? OUTCOME.SUCCESS : OUTCOME.FAILURE,
      });
    }
    if (status === 'FAILED') {
      failuresCounter.add(1, { fail_reason: failReason ?? 'ffmpeg_stop_failed' });
    }
    // Fix E: warm the annotated-mp4 cache off the critical path so a later
    // Download is served from cache instead of an on-demand burn-in. Only
    // for finalized recordings that actually carry annotations.
    if (status === 'STOPPED' && ((r.annotations?.length as number) ?? 0) > 0) {
      this.prewarmAnnotatedRender(r.id);
    }
    return { id: r.id, udid: r.device_udid, status, durationMs, sizeBytes };
  }

  /**
   * The ffmpeg for one recording exited without us asking it to.
   *
   * The usual cause is the source ending: the device stopped answering, so the
   * MJPEG server disconnected its clients (see AndroidStreamService and issue
   * #200) and ffmpeg saw end-of-input. The mp4 is valid, just shorter than
   * requested. Nothing else reconciles the row, so without this it sits at
   * RECORDING — no ended_at, no duration, no size — until a manual Stop or
   * until recoverOnBoot marks it FAILED on the next server restart, which is
   * both late and wrong for a recording that ended cleanly. See issue #203.
   */
  private async handleSourceEnded(recordingId: string, code: number | null): Promise<void> {
    if (this.finalizing.has(recordingId)) return; // a stop is already on it
    this.finalizing.add(recordingId);
    try {
      const r: any = await this.store.findById(recordingId);
      if (!r || r.status !== 'RECORDING') return;
      recLog.warn(
        `Recording ${recordingId} for ${r.device_udid}: ffmpeg exited on its own ` +
          `(${code === null ? 'signal' : `code ${code}`}); finalizing it here rather than ` +
          'leaving the row open until someone presses Stop.',
      );
      const one = await this.finalizeRecording(r, { endedBySource: true });
      this.eventMgr.emitRecordingStopped({ groupId: r.group_id, recordings: [one] });
    } catch (err: any) {
      recLog.warn(`source-ended finalize failed for ${recordingId}: ${err?.message ?? err}`);
    } finally {
      this.finalizing.delete(recordingId);
    }
  }

  /**
   * Stop all recordings in a group. Each recording is finalized independently
   * (one ffmpeg failure does not abort the others), the gate slot is released,
   * and the manual block is released. Idempotent.
   *
   * `failReason` is recorded on each recording that stops cleanly; an
   * observer group is stopped with `session_ended`.
   */
  async stop(
    groupId: string,
    opts: { failReason?: string } = {},
  ): Promise<{
    groupId: string;
    recordings: Array<{
      id: string;
      udid: string;
      status: string;
      durationMs?: number;
      sizeBytes?: number;
    }>;
  }> {
    ensureOtelInstruments();
    const span = trace.getTracer('xenon.recording').startSpan('xenon.recording.stop', {
      attributes: { [ATTR.RECORDING_GROUP_ID]: groupId },
    });
    // Before anything is awaited, so a second ending of one of its sessions,
    // or the claim check's next tick, finds the group already stopping.
    this.unwatchObserverGroup(groupId);

    try {
      // Stop the composite first so its ffmpeg flushes its trailer cleanly
      // before we start tearing down per-device sources.
      try {
        await this.videoPipeline.stopComposite(groupId);
      } catch (err: any) {
        recLog.warn(`Composite stop failed for group ${groupId}: ${err?.message}`);
        compositeFailuresCounter.add(1);
        span.addEvent('composite_stop_failed', { reason: err?.message ?? 'unknown' });
      }
      const recordings = await this.store.listGroup(groupId);
      const out: Array<{
        id: string;
        udid: string;
        status: string;
        durationMs?: number;
        sizeBytes?: number;
      }> = [];
      for (const r of recordings as any[]) {
        // A phone whose recording already ended (its source ended, or this
        // is a second stop), or that handleSourceEnded is finalizing now, is
        // reported as it stands. Finalizing it again overwrote its end,
        // duration and fail_reason, and let go of the phone a second time.
        if (r.status === 'STOPPED' || r.status === 'FAILED' || this.finalizing.has(r.id)) {
          out.push({
            id: r.id,
            udid: r.device_udid,
            status: r.status,
            durationMs: r.duration_ms ?? undefined,
            sizeBytes: r.size_bytes ?? undefined,
          });
          continue;
        }
        // Claim it so an ffmpeg exit landing mid-stop doesn't finalize the same
        // row from handleSourceEnded at the same time.
        this.finalizing.add(r.id);
        try {
          out.push(await this.finalizeRecording(r, { failReason: opts.failReason }));
        } finally {
          this.finalizing.delete(r.id);
        }
      }
      this.prewarmCompositeRender(groupId);
      this.eventMgr.emitRecordingStopped({ groupId, recordings: out });
      span.setStatus({ code: SpanStatusCode.OK });
      return { groupId, recordings: out };
    } catch (err: any) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message ?? 'unknown' });
      throw err;
    } finally {
      span.end();
    }
  }

  /**
   * One of the sessions an observer group films has ended (forgetSessionMemory
   * calls this for every ending, observed or not). The whole group stops, the
   * composite included: the phones' streams go on after the session, and the
   * group must never film the next test on them. A second call, or one for a
   * session no group films, does nothing. Never throws.
   */
  async sessionEnded(sessionId: string): Promise<void> {
    try {
      for (const pending of this.pendingObserverStarts) {
        if (pending.sessionIds.has(sessionId)) pending.ended = true;
      }
      const groupId = this.observedBy.get(sessionId);
      if (!groupId) return;
      recLog.info(`Session ${sessionId} ended; stopping observer group ${groupId}.`);
      await this.stop(groupId, { failReason: 'session_ended' });
    } catch (err: any) {
      recLog.warn(
        `Stopping the recording of ended session ${sessionId} failed: ${err?.message ?? err}`,
      );
    }
  }

  /** Whether the group was started in observer mode (add-device refuses it). */
  isObserverGroup(groupId: string): boolean {
    return this.observerGroupIds.has(groupId);
  }

  /**
   * Note an observer group, and while it records, watch its sessions: the
   * hook's map, and a timer that checks every observerCheckMs that each
   * phone's claim still names its session, for an ending the hook missed.
   */
  private watchObserverGroup(groupId: string, sessions: ObservedPhone[], recording: boolean) {
    this.observerGroupIds.add(groupId);
    while (this.observerGroupIds.size > OBSERVER_GROUPS_REMEMBERED) {
      this.observerGroupIds.delete(this.observerGroupIds.values().next().value as string);
    }
    if (!recording) return;
    const timer = setInterval(() => void this.checkObserverGroup(groupId), this.observerCheckMs);
    timer.unref();
    this.observerGroups.set(groupId, { sessions, timer, checking: false });
    for (const p of sessions) this.observedBy.set(p.sessionId, groupId);
  }

  private unwatchObserverGroup(groupId: string): void {
    const group = this.observerGroups.get(groupId);
    if (!group) return;
    clearInterval(group.timer);
    this.observerGroups.delete(groupId);
    for (const p of group.sessions) {
      if (this.observedBy.get(p.sessionId) === groupId) this.observedBy.delete(p.sessionId);
    }
  }

  /**
   * The backstop: the first observed phone whose claim no longer names its
   * session ends the group, as its session's ending would have. A lookup that
   * fails stops nothing.
   */
  private async checkObserverGroup(groupId: string): Promise<void> {
    const group = this.observerGroups.get(groupId);
    if (!group || group.checking) return;
    group.checking = true;
    try {
      for (const p of group.sessions) {
        let holds = true;
        try {
          holds = await this.claimHoldsFn(p.udid, p.sessionId);
        } catch (err: any) {
          recLog.debug(`Claim check of ${p.udid} (${p.sessionId}) failed: ${err?.message ?? err}`);
        }
        if (this.observerGroups.get(groupId) !== group) return; // stopped meanwhile
        if (!holds) {
          recLog.warn(
            `Observer group ${groupId}: ${p.udid} no longer runs session ${p.sessionId}; stopping the group.`,
          );
          await this.sessionEnded(p.sessionId);
          return;
        }
      }
    } finally {
      group.checking = false;
    }
  }

  /**
   * Fire-and-forget, like the per-device pre-render: burn marks into the
   * composite now so its download is served warm. Only groups whose composite
   * has a layout record and marks do any work.
   */
  private prewarmCompositeRender(groupId: string): void {
    void (async () => {
      try {
        if (!fs.existsSync(compositeLayoutPath(groupId))) return;
        const { AnnotationRenderService } = await import('./annotation-render');
        const out = await Container.get(AnnotationRenderService).resolveCompositePath(groupId);
        if (out.annotated) recLog.info(`Pre-rendered annotated composite for ${groupId}`);
      } catch (err: any) {
        recLog.warn(`Composite pre-render failed for ${groupId}: ${err?.message ?? err}`);
      }
    })();
  }

  /** Best effort: without it the video's marks are simply not shifted. */
  private recordTiming(filePath: string, spawnedAtMs: number, groupT0Ms: number): void {
    try {
      writeRecordingTiming(filePath, { spawnedAtMs, groupT0Ms });
    } catch (err: any) {
      recLog.warn(`Recording timing not saved for ${filePath}: ${err?.message ?? err}`);
    }
  }

  /** The group's t=0, from any of its recordings that has a timing record. */
  private async groupT0Ms(groupId: string, exceptId: string): Promise<number | undefined> {
    try {
      for (const r of (await this.store.listGroup(groupId)) as any[]) {
        if (r.id === exceptId || !r.file_path) continue;
        const t0 = readRecordingTiming(r.file_path)?.groupT0Ms;
        if (t0 !== undefined) return t0;
      }
    } catch {
      /* unknown t=0: leave this device unshifted */
    }
    return undefined;
  }

  /**
   * Record the composite's cells so marks can be burned into it later. Best
   * effort: without the file the composite is simply served without marks.
   */
  private writeCompositeLayout(
    groupId: string,
    geometry: CompositeGeometry | undefined,
    inputs: Array<{ udid: string }>,
    recordings: StartedRecording[],
  ): void {
    if (!geometry) return;
    try {
      const layout: CompositeLayoutFile = {
        version: 1,
        cellW: geometry.cellW,
        cellH: geometry.cellH,
        cols: geometry.cols,
        rows: geometry.rows,
        cells: inputs.map((input, index) => ({
          index,
          udid: input.udid,
          recordingId: recordings.find((r) => r.udid === input.udid)!.id,
        })),
      };
      const file = compositeLayoutPath(groupId);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(layout, null, 2));
    } catch (err: any) {
      recLog.warn(`Composite layout not recorded for ${groupId}: ${err?.message ?? err}`);
    }
  }

  /**
   * Fire-and-forget: burn annotations into `<id>.annotated.mp4` right after
   * stop so the dashboard Download is served from a warm cache instead of an
   * on-demand encode. Best-effort — a Download that races this render falls
   * back to the same on-demand path, and any failure is logged, not thrown.
   */
  private prewarmAnnotatedRender(recordingId: string): void {
    void (async () => {
      try {
        const { AnnotationRenderService } = await import('./annotation-render');
        await Container.get(AnnotationRenderService).resolvePlayablePath(recordingId);
        recLog.info(`Pre-rendered annotated mp4 for ${recordingId}`);
      } catch (err: any) {
        recLog.warn(`Annotated pre-render failed for ${recordingId}: ${err?.message ?? err}`);
      }
    })();
  }

  /**
   * Let go of a phone whose recording has ended.
   *
   * This server's own phone goes to the live preview's leave path, as a page
   * that stops watching it does. After a short grace, which also lets this
   * recording's own ffmpeg connection drop, its preview is stopped and its
   * hold released, unless someone watches it or another recording reads it.
   * Whether its stream is running says nothing: the recording starts the
   * stream itself when none runs (ensureMjpegForRecording). Taking that
   * stream for a preview's kept the phone held, with nobody watching, until
   * the stream's idle watchdog ten minutes later.
   *
   * A node's phone has no stream on this server, so nobody here watches it:
   * its hold goes at once.
   */
  private async letGoOfDevice(udid: string, host: string, fromNode: boolean): Promise<void> {
    if (fromNode) {
      await this.tryUnblock(udid, host);
      return;
    }
    this.leaveDeviceFn(udid);
  }

  async addBookmark(
    groupId: string,
    recordingId: string,
    timecodeMs: number,
    label: string,
    note?: string,
  ) {
    const bm = await this.store.addBookmark(recordingId, label, timecodeMs, note);
    this.eventMgr.emitRecordingBookmark({ groupId, bookmark: bm });
    return bm;
  }

  async addAnnotation(
    groupId: string,
    recordingId: string,
    ann: {
      timecodeMs: number;
      shape: string;
      geometry: string;
      color: string;
      text?: string;
      author?: string;
    },
    /** The mark as the preview drew it; burned in instead of the drawbox fallback. */
    png?: Buffer,
  ) {
    const a = await this.store.addAnnotation(recordingId, ann);
    if (png) {
      try {
        const rec: any = await this.store.findById(recordingId);
        if (rec?.file_path) {
          const file = annotationImagePath(rec.file_path, a.id);
          await fs.promises.mkdir(path.dirname(file), { recursive: true });
          await fs.promises.writeFile(file, png);
        }
      } catch (err: any) {
        // The row is saved, so the mark still renders, just with the drawbox fallback.
        recLog.warn(`annotation image not saved for ${a.id}: ${err?.message ?? err}`);
      }
    }
    this.eventMgr.emitRecordingAnnotation({ groupId, annotation: a });
    return a;
  }

  /**
   * "Clear marks": closes the open marks of the group's recordings. With
   * `onlyRecordingIds`, only of those among them: the phones the caller can
   * see, since a group can hold another team's phone. Undefined means the
   * whole group, which is what the button does for an admin.
   */
  async clearAnnotations(
    groupId: string,
    timecodeMs: number,
    onlyRecordingIds?: string[],
  ): Promise<{ cleared: number }> {
    const rows = await this.store.listGroup(groupId);
    const ids = rows
      .map((r: any) => r.id as string)
      .filter((id) => !onlyRecordingIds || onlyRecordingIds.includes(id));
    const cleared = await this.store.clearAnnotations(ids, timecodeMs);
    return { cleared };
  }

  /**
   * Add a single device to a running recording group. Atomic — if the UDID is
   * busy or the concurrency cap would be exceeded, no row is written and no
   * ffmpeg is spawned.
   */
  async addDevice(
    groupId: string,
    udid: string,
    actorId: string,
  ): Promise<{ recording: StartedRecording }> {
    ensureOtelInstruments();
    if (!actorId) {
      throw new Error('RecordingOrchestrator.addDevice: actorId is required');
    }
    // An observer group records the sessions it was started with, nothing else.
    if (this.isObserverGroup(groupId)) {
      throw new RecordingError('observer_group');
    }

    const span = trace.getTracer('xenon.recording').startSpan('xenon.recording.add_device', {
      attributes: { [ATTR.RECORDING_GROUP_ID]: groupId },
    });
    attemptsCounter.add(1);

    try {
      const result = await this._addDeviceInternal(groupId, udid, actorId);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err: any) {
      const failReason = err instanceof RecordingError ? err.code : (err?.message ?? 'unknown');
      failuresCounter.add(1, { fail_reason: failReason });
      span.setAttributes({ [ATTR.RECORDING_FAIL_REASON]: failReason });
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: failReason });
      throw err;
    } finally {
      span.end();
    }
  }

  private async _addDeviceInternal(
    groupId: string,
    udid: string,
    actorId: string,
  ): Promise<{ recording: StartedRecording }> {
    // Layer 2 atomic pre-check: busy state.
    const busy = await this.busyPrecheck.findBusy([udid], actorId);
    if (busy.length > 0) {
      throw new RecordingError('device_busy', busy);
    }

    const recordingId = uuidv4();
    if (!this.gate.tryAcquire([recordingId])) {
      throw new RecordingError(
        'concurrency_cap',
        undefined,
        this.gate.getLimit(),
        this.gate.activeCount(),
      );
    }

    let host = '127.0.0.1';
    try {
      const dev = await DeviceStoreFactory.getStore().findDevice({ udid });
      host = dev?.host ?? '127.0.0.1';
    } catch {
      this.gate.release(recordingId);
      throw new RecordingError('device_busy', [{ udid, reason: 'unknown' }]);
    }

    try {
      await this.blockDeviceFn(udid, host, formatManualLock(actorId, udid));
    } catch (err: any) {
      this.gate.release(recordingId);
      throw new RecordingError('device_busy', [{ udid, reason: 'unknown' }]);
    }

    const filePath = (Container.get(ARTIFACT_STORE) as ArtifactStore).resolve(
      recordingId,
      'video',
      `${recordingId}.mp4`,
    );
    try {
      const mjpegPort = await this.sourcePort(recordingId, udid, actorId);
      await this.store.create({
        id: recordingId,
        groupId,
        deviceUdid: udid,
        deviceHost: host,
        filePath,
        sessionId: null,
        deviceSnapshot: null,
        startedBy: actorId,
      });
      await this.videoPipeline.startRecording({
        sessionId: recordingId,
        udid,
        outputPath: filePath,
        mjpegPort,
      });
      // Joined after t=0: its marks shift back by how late it started.
      const spawnedAtMs = this.now();
      const groupT0Ms = await this.groupT0Ms(groupId, recordingId);
      if (groupT0Ms !== undefined) this.recordTiming(filePath, spawnedAtMs, groupT0Ms);
    } catch (err: any) {
      recLog.error(`Failed to add device ${udid} to group ${groupId}: ${err?.message}`);
      await this.closeNodeSource(recordingId);
      this.gate.release(recordingId);
      await this.tryUnblock(udid, host);
      try {
        await this.store.finalize(recordingId, {
          status: 'FAILED',
          failReason: err?.message ?? 'spawn_failed',
        });
      } catch {
        /* ignore */
      }
      this.eventMgr.emitRecordingFailed({
        groupId,
        recordingId,
        udid,
        reason: err?.message ?? 'spawn_failed',
      });
      throw err;
    }

    const recording: StartedRecording = { id: recordingId, udid, status: 'RECORDING' };
    this.eventMgr.emitRecordingStarted({
      groupId,
      recordings: [{ id: recordingId, udid }],
      startedAt: new Date(),
    });
    return { recording };
  }

  /**
   * Boot-time recovery: any RECORDING row left from a previous process is
   * marked FAILED with reason=server_restart and its manual block is released.
   * Mirrors the existing session-cleanup pattern.
   */
  async recoverOnBoot(): Promise<void> {
    ensureOtelInstruments();
    let orphans: any[];
    try {
      orphans = await this.store.listActive();
    } catch (err: any) {
      recLog.warn(`recoverOnBoot listActive failed: ${err?.message}`);
      return;
    }
    for (const o of orphans) {
      try {
        await this.store.finalize(o.id, {
          status: 'FAILED',
          failReason: 'server_restart',
        });
      } catch (err: any) {
        recLog.warn(`finalize failed during recover for ${o.id}: ${err?.message}`);
      }
      this.gate.release(o.id);
      await this.tryUnblock(o.device_udid, o.device_host ?? '127.0.0.1');
      failuresCounter.add(1, { fail_reason: 'server_restart' });
    }
    if (orphans.length > 0) {
      recLog.warn(`Recovered ${orphans.length} orphan recordings on boot.`);
    }

    // Also free devices that still hold a manual_* lock with no live stream
    // (e.g. process death after stream/start but before stream/stop).
    try {
      const { DeviceStoreFactory } = await import('../../data-service/device-store');
      const { isManualLock } = await import('./manualLock');
      const devices = await DeviceStoreFactory.getStore().getDevices({});
      for (const d of devices) {
        if (!d.busy || !isManualLock(d.session_id)) continue;
        let live = false;
        try {
          const { default: IOSStreamService } =
            await import('../../device-managers/ios/IOSStreamService');
          if (Container.get(IOSStreamService).getStreamStatus(d.udid)) live = true;
        } catch {
          /* ignore */
        }
        if (!live) {
          try {
            const { default: AndroidStreamService } =
              await import('../../device-managers/android/AndroidStreamService');
            if (Container.get(AndroidStreamService).getStreamStatus(d.udid)) live = true;
          } catch {
            /* ignore */
          }
        }
        if (!live) {
          try {
            const { default: AndroidH264StreamService } =
              await import('../../device-managers/android/AndroidH264StreamService');
            if (Container.get(AndroidH264StreamService).getMultiplexer(d.udid)) live = true;
          } catch {
            /* ignore */
          }
        }
        if (live) continue;
        recLog.warn(
          `recoverOnBoot: releasing orphaned manual lock on ${d.udid} (${d.session_id})`,
        );
        await this.tryUnblock(d.udid, d.host);
      }
    } catch (err: any) {
      recLog.warn(`recoverOnBoot manual-lock sweep failed: ${err?.message}`);
    }
  }

  /**
   * The loopback port a recording reads: this server's own phone's MJPEG
   * stream, or, for another server's phone, a relay to its node's, kept until
   * the recording is finalized (nodeRecordingSource.ts).
   */
  private async sourcePort(recordingId: string, udid: string, actorId: string): Promise<number> {
    const relay = await this.nodeSourceFn(udid, actorId);
    if (!relay) return this.ensureMjpegPortFn(udid);
    this.nodeSources.set(recordingId, relay);
    return relay.port;
  }

  private async closeNodeSource(recordingId: string): Promise<void> {
    const relay = this.nodeSources.get(recordingId);
    if (!relay) return;
    this.nodeSources.delete(recordingId);
    await relay.close().catch((err: any) => {
      recLog.warn(`Closing the node relay of ${recordingId} failed: ${err?.message ?? err}`);
    });
  }

  private async tryUnblock(udid: string, host: string): Promise<void> {
    try {
      await this.unblockDeviceFn(udid, host);
    } catch (err: any) {
      recLog.warn(`Best-effort unblock failed for ${udid}@${host}: ${err?.message}`);
    }
  }
}
