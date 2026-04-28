import { Service, Container } from 'typedi';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config';
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
import log from '../../logger';

const recLog = log.scope('RecordingOrchestrator');

/**
 * Canonical on-disk location for a group's composite mp4. Kept as a single
 * helper so the router, bundle, and orchestrator all agree on the path
 * without needing a schema column. Sits in a `_groups/<groupId>` subtree to
 * stay clear of per-recording-id folders.
 */
export function compositeOutputPath(groupId: string): string {
  return path.join(config.recordingsAssetsPath, '_groups', groupId, 'composite.mp4');
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
}

@Service()
export class RecordingOrchestrator {
  // All deps are public so tests can rebind a single one without rebuilding.
  public unblockDeviceFn: UnblockDeviceFn;
  public blockDeviceFn: BlockDeviceFn;
  private readonly _deps: Required<Omit<OrchestratorDeps, 'blockDeviceFn' | 'unblockDeviceFn'>>;

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
  }

  private get busyPrecheck() { return this._deps.busyPrecheck; }
  private get store() { return this._deps.store; }
  private get gate() { return this._deps.gate; }
  private get videoPipeline() { return this._deps.videoPipeline; }
  private get eventMgr() { return this._deps.eventMgr; }

  /**
   * Start a recording group. Atomic — if any UDID is busy or the cap would be
   * exceeded, no rows are written, no ffmpeg is spawned, no manual blocks are
   * taken.
   */
  async start(input: StartInput): Promise<{
    groupId: string;
    recordings: StartedRecording[];
    startedAt: Date;
  }> {
    const { udids, sessionId, actorId } = input;
    if (!actorId) {
      throw new Error('RecordingOrchestrator.start: actorId is required');
    }

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
      throw new RecordingError('device_busy', [
        { udid: 'unknown', reason: 'unknown' },
      ]);
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
      throw new RecordingError('device_busy', [
        { udid: 'unknown', reason: 'unknown' },
      ]);
    }

    // Create rows and spawn ffmpeg per device.
    const recordings: StartedRecording[] = [];
    for (let i = 0; i < udids.length; i++) {
      const id = recordingIds[i];
      const udid = udids[i];
      const host = deviceHosts[udid];
      const filePath = path.join(config.recordingsAssetsPath, id, 'video', `${id}.mp4`);
      try {
        await this.store.create({
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
      }
    }

    // Mosaic composite: one mp4 with all devices side-by-side. Skipped for
    // single-device groups (the per-device mp4 IS the "whole screen").
    if (recordings.length >= 2) {
      try {
        const compositeInputs: { mjpegPort: number; udid: string }[] = [];
        for (const r of recordings) {
          const dev = await DeviceStoreFactory.getStore().findDevice({ udid: r.udid });
          if (dev?.mjpegServerPort) {
            compositeInputs.push({ udid: r.udid, mjpegPort: dev.mjpegServerPort });
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
        } else {
          recLog.warn(
            `Composite skipped for group ${groupId}: not enough MJPEG ports resolved (${compositeInputs.length}/${recordings.length}).`,
          );
        }
      } catch (err: any) {
        // Composite failure is non-fatal — per-device recordings continue.
        recLog.warn(`Composite start failed for group ${groupId}: ${err?.message}`);
      }
    }

    this.eventMgr.emitRecordingStarted({
      groupId,
      recordings: recordings.map((r) => ({ id: r.id, udid: r.udid })),
      startedAt,
    });
    return { groupId, recordings, startedAt };
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
    // Stop the composite first so its ffmpeg flushes its trailer cleanly
    // before we start tearing down per-device sources.
    try {
      await this.videoPipeline.stopComposite(groupId);
    } catch (err: any) {
      recLog.warn(`Composite stop failed for group ${groupId}: ${err?.message}`);
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
      let status: 'STOPPED' | 'FAILED' = 'STOPPED';
      let failReason: string | undefined;
      try {
        await this.videoPipeline.stopRecording(r.id);
      } catch (err: any) {
        status = 'FAILED';
        failReason = err?.message ?? 'ffmpeg_stop_failed';
      }
      const durationMs = r.started_at
        ? Date.now() - new Date(r.started_at).getTime()
        : undefined;
      let sizeBytes: number | undefined;
      try {
        sizeBytes = fs.statSync(r.file_path).size;
      } catch {
        // File may not exist on FAIL; leave size undefined.
      }
      try {
        await this.store.finalize(r.id, { status, durationMs, sizeBytes, failReason });
      } catch (err: any) {
        recLog.warn(`finalize failed for ${r.id}: ${err?.message}`);
      }
      this.gate.release(r.id);
      await this.releaseLockIfNotInheritedFromMosaic(
        r.device_udid,
        r.device_host ?? '127.0.0.1',
      );
      out.push({ id: r.id, udid: r.device_udid, status, durationMs, sizeBytes });
    }
    this.eventMgr.emitRecordingStopped({ groupId, recordings: out });
    return { groupId, recordings: out };
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
      const { default: IOSStreamService } = await import(
        '../../device-managers/ios/IOSStreamService'
      );
      const ios = Container.get(IOSStreamService);
      const iosSession = ios.getStreamStatus(udid);
      if (iosSession?.status === 'running') mosaicStreamRunning = true;
    } catch {
      /* ignore — service may not be registered in this context */
    }
    if (!mosaicStreamRunning) {
      try {
        const { default: AndroidStreamService } = await import(
          '../../device-managers/android/AndroidStreamService'
        );
        const android = Container.get(AndroidStreamService);
        const aSession = android.getStreamStatus(udid);
        if (aSession?.status === 'running') mosaicStreamRunning = true;
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
    if (!actorId) {
      throw new Error('RecordingOrchestrator.addDevice: actorId is required');
    }
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

    const filePath = path.join(config.recordingsAssetsPath, recordingId, 'video', `${recordingId}.mp4`);
    try {
      await this.store.create({
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
      } catch { /* ignore */ }
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
    }
    if (orphans.length > 0) {
      recLog.warn(`Recovered ${orphans.length} orphan recordings on boot.`);
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
