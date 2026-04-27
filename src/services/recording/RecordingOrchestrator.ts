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
import log from '../../logger';

const recLog = log.scope('RecordingOrchestrator');

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

@Service()
export class RecordingOrchestrator {
  // Expose for test override; default wired through constructor injection.
  public unblockDeviceFn: UnblockDeviceFn;

  constructor(
    private readonly busyPrecheck: BusyPrecheck = Container.get(BusyPrecheck),
    private readonly store: RecordingStore = Container.get(RecordingStore),
    private readonly gate: ConcurrencyGate = Container.get(ConcurrencyGate),
    private readonly videoPipeline: VideoPipelineService = Container.get(VideoPipelineService),
    private readonly blockDeviceFn: BlockDeviceFn = defaultBlockDevice,
    private readonly eventMgr: DashboardEventManager = Container.get(DashboardEventManager),
    unblockDeviceFn?: UnblockDeviceFn,
  ) {
    this.unblockDeviceFn = unblockDeviceFn ?? defaultUnblockDevice;
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
  }> {
    const { udids, sessionId } = input;

    // Layer 2 atomic pre-check: busy state.
    const busy = await this.busyPrecheck.findBusy(udids);
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
        await this.blockDeviceFn(udid, host, `manual_${udid}`);
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
      await this.tryUnblock(r.device_udid, r.device_host ?? '127.0.0.1');
      out.push({ id: r.id, udid: r.device_udid, status, durationMs, sizeBytes });
    }
    this.eventMgr.emitRecordingStopped({ groupId, recordings: out });
    return { groupId, recordings: out };
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
