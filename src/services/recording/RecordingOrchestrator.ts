import { Service, Container } from 'typedi';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { trace, metrics, SpanStatusCode, Counter, Histogram, Span } from '@opentelemetry/api';
import { VideoPipelineService } from '../VideoPipelineService';
import { DashboardEventManager } from '../../dashboard/event-manager';
import { BusyPrecheck, BusyEntry } from './busy-precheck';
import { RecordingStore } from './recording-store';
import { ConcurrencyGate } from './concurrency-gate';
import {
  blockDevice as defaultBlockDevice,
  unblockDevice as defaultUnblockDevice,
} from '../../data-service/device-service';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { formatManualLock } from './manualLock';
import { ensureMjpegForRecording } from './ensureMjpegForRecording';
import { ATTR, METRIC, OUTCOME } from '../telemetry/attributes';
import log from '../../logger';
import { ARTIFACT_STORE } from '../artifacts/ArtifactStore';
import type { ArtifactStore } from '../artifacts/ArtifactStore';

const recLog = log.scope('RecordingOrchestrator');

/** Below this size after stop, treat the mp4 as empty/corrupt. */
const MIN_PLAYABLE_MP4_BYTES = 1024;

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

export class RecordingError extends Error {
  constructor(
    public readonly code: 'device_busy' | 'concurrency_cap',
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
}

export interface BlockDeviceFn {
  (udid: string, host: string, sessionId?: string): Promise<void>;
}
export interface UnblockDeviceFn {
  (udid: string, host: string): Promise<void>;
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
}

@Service()
export class RecordingOrchestrator {
  // All deps are public so tests can rebind a single one without rebuilding.
  public unblockDeviceFn: UnblockDeviceFn;
  public blockDeviceFn: BlockDeviceFn;
  public ensureMjpegPortFn: (udid: string) => Promise<number>;
  private readonly _deps: Required<
    Omit<OrchestratorDeps, 'blockDeviceFn' | 'unblockDeviceFn' | 'ensureMjpegPortFn'>
  >;
  /**
   * Recording ids currently being closed out. Both the user-initiated stop and
   * an ffmpeg self-exit finalize rows, and they can land at the same instant —
   * this keeps exactly one of them doing it.
   */
  private readonly finalizing = new Set<string>();

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
    const { udids, sessionId, actorId } = input;

    // Layer 2 atomic pre-check: busy state.
    const busy = await this.busyPrecheck.findBusy(udids, actorId);
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

    // Look up host for each device (needed for block/unblock).
    const deviceHosts: Record<string, string> = {};
    try {
      for (const udid of udids) {
        const dev = await DeviceStoreFactory.getStore().findDevice({ udid });
        deviceHosts[udid] = dev?.host ?? '127.0.0.1';
      }
    } catch (err: any) {
      // If device lookup fails, abort cleanly.
      for (const id of recordingIds) this.gate.release(id);
      throw new RecordingError('device_busy', [{ udid: 'unknown', reason: 'unknown' }]);
    }

    // Take manual blocks transactionally. If any fails, roll back.
    try {
      for (const udid of udids) {
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
    for (let i = 0; i < udids.length; i++) {
      const id = recordingIds[i];
      const udid = udids[i];
      const host = deviceHosts[udid];
      const filePath = (Container.get(ARTIFACT_STORE) as ArtifactStore).resolve(
        id,
        'video',
        `${id}.mp4`,
      );
      try {
        const mjpegPort = await this.ensureMjpegPortFn(udid);
        mjpegPorts[udid] = mjpegPort;
        await this.store.create({
          id,
          groupId,
          deviceUdid: udid,
          deviceHost: host,
          filePath,
          sessionId: sessionId ?? null,
          deviceSnapshot: null,
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
        recordings.push({ id, udid, status: 'RECORDING' });
      } catch (err: any) {
        recLog.error(`Failed to start recording for ${udid}: ${err?.message}`);
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
        await this.tryUnblock(udid, host);
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
          await this.videoPipeline.startComposite({
            groupId,
            inputs: compositeInputs,
            outputPath: compositePath,
          });
          recLog.info(`Composite recording started for group ${groupId} → ${compositePath}`);
          compositeEnabled = true;
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
    return { groupId, recordings, startedAt, compositeEnabled };
  }

  /**
   * Close out one recording: stop its ffmpeg, size the file, decide the terminal
   * status, persist it, release the gate slot and the device lock, and record
   * the metrics. Shared by the user-initiated stop path and by
   * handleSourceEnded, so the two can never drift.
   */
  private async finalizeRecording(
    r: any,
    opts: { endedBySource?: boolean } = {},
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
    const durationMs = r.started_at ? Date.now() - new Date(r.started_at).getTime() : undefined;
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
    }
    try {
      await this.store.finalize(r.id, { status, durationMs, sizeBytes, failReason });
    } catch (err: any) {
      recLog.warn(`finalize failed for ${r.id}: ${err?.message}`);
    }
    this.gate.release(r.id);
    await this.releaseLockIfNotInheritedFromMosaic(r.device_udid, r.device_host ?? '127.0.0.1');
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
   */
  async stop(groupId: string): Promise<{
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
        // Claim it so an ffmpeg exit landing mid-stop doesn't finalize the same
        // row from handleSourceEnded at the same time.
        this.finalizing.add(r.id);
        try {
          out.push(await this.finalizeRecording(r));
        } finally {
          this.finalizing.delete(r.id);
        }
      }
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
   * Stop-time unblock that respects the mosaic preview. If the mosaic's
   * stream service is still actively streaming this device (its lock value
   * is `manual_${udid}` — same string the orchestrator wrote, but conceptually
   * owned by the mosaic), we leave the lock in place so the preview keeps
   * working and so automation doesn't grab the device underneath it.
   */
  private async releaseLockIfNotInheritedFromMosaic(udid: string, host: string): Promise<void> {
    let mosaicStreamRunning = false;
    try {
      // Lazy import — keeps the orchestrator usable in tests that don't
      // wire stream services into the DI container.
      const { default: IOSStreamService } =
        await import('../../device-managers/ios/IOSStreamService');
      const ios = Container.get(IOSStreamService);
      const iosSession = ios.getStreamStatus(udid);
      if (iosSession?.status === 'running') mosaicStreamRunning = true;
    } catch {
      /* ignore — service may not be registered in this context */
    }
    if (!mosaicStreamRunning) {
      try {
        const { default: AndroidStreamService } =
          await import('../../device-managers/android/AndroidStreamService');
        const android = Container.get(AndroidStreamService);
        const aSession = android.getStreamStatus(udid);
        if (aSession?.status === 'running') mosaicStreamRunning = true;
      } catch {
        /* ignore */
      }
    }
    // H.264 preview (androidH264) has no MJPEG session — check it too or we
    // drop the mosaic lock underneath a live WebCodecs tile.
    if (!mosaicStreamRunning) {
      try {
        const { default: AndroidH264StreamService } =
          await import('../../device-managers/android/AndroidH264StreamService');
        if (Container.get(AndroidH264StreamService).getMultiplexer(udid)) {
          mosaicStreamRunning = true;
        }
      } catch {
        /* ignore */
      }
    }
    if (mosaicStreamRunning) {
      recLog.info(
        `Recording stop: keeping manual lock on ${udid} because the mosaic preview is still active.`,
      );
      return;
    }
    await this.tryUnblock(udid, host);
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
  ) {
    const a = await this.store.addAnnotation(recordingId, ann);
    this.eventMgr.emitRecordingAnnotation({ groupId, annotation: a });
    return a;
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
      const mjpegPort = await this.ensureMjpegPortFn(udid);
      await this.store.create({
        id: recordingId,
        groupId,
        deviceUdid: udid,
        deviceHost: host,
        filePath,
        sessionId: null,
        deviceSnapshot: null,
      });
      await this.videoPipeline.startRecording({
        sessionId: recordingId,
        udid,
        outputPath: filePath,
        mjpegPort,
      });
    } catch (err: any) {
      recLog.error(`Failed to add device ${udid} to group ${groupId}: ${err?.message}`);
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

  private async tryUnblock(udid: string, host: string): Promise<void> {
    try {
      await this.unblockDeviceFn(udid, host);
    } catch (err: any) {
      recLog.warn(`Best-effort unblock failed for ${udid}@${host}: ${err?.message}`);
    }
  }
}
