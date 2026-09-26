import { Service } from 'typedi';
import { prisma } from '../../prisma';

export interface CreateRecordingInput {
  /** Explicit primary key — must match the ffmpeg session key / file path. */
  id: string;
  groupId: string;
  deviceUdid: string;
  deviceHost: string;
  filePath: string;
  sessionId: string | null;
  deviceSnapshot: string | null;
}

export interface FinalizeInput {
  status: 'STOPPED' | 'FAILED' | 'DISCARDED';
  durationMs?: number;
  sizeBytes?: number;
  failReason?: string;
}

@Service()
export class RecordingStore {
  async create(input: CreateRecordingInput) {
    return prisma.recording.create({
      data: {
        id: input.id,
        group_id: input.groupId,
        device_udid: input.deviceUdid,
        device_host: input.deviceHost,
        file_path: input.filePath,
        session_id: input.sessionId ?? undefined,
        device_snapshot: input.deviceSnapshot ?? undefined,
        started_at: new Date(),
        status: 'RECORDING',
      },
    });
  }

  async finalize(id: string, input: FinalizeInput) {
    return prisma.recording.update({
      where: { id },
      data: {
        status: input.status,
        ended_at: new Date(),
        duration_ms: input.durationMs,
        size_bytes: input.sizeBytes,
        fail_reason: input.failReason,
      },
    });
  }

  async listActive() {
    return prisma.recording.findMany({ where: { status: 'RECORDING' } });
  }

  /**
   * The device's in-progress recording and its group, or null. stream/stop
   * checks this: stopping the stream under a live recording loses all of it.
   */
  async activeRecordingFor(udid: string): Promise<{ id: string; groupId: string } | null> {
    const rec = await prisma.recording.findFirst({
      where: { status: 'RECORDING', device_udid: udid },
      select: { id: true, group_id: true },
    });
    return rec ? { id: rec.id, groupId: rec.group_id } : null;
  }

  /** Whether a device currently has an in-progress recording. */
  async isRecording(udid: string): Promise<boolean> {
    const count = await prisma.recording.count({
      where: { status: 'RECORDING', device_udid: udid },
    });
    return count > 0;
  }

  async listGroup(groupId: string) {
    return prisma.recording.findMany({
      where: { group_id: groupId },
      include: { bookmarks: true, annotations: true },
    });
  }

  async findById(id: string) {
    return prisma.recording.findUnique({
      where: { id },
      include: { bookmarks: true, annotations: true },
    });
  }

  async addBookmark(recordingId: string, label: string, timecodeMs: number, note?: string) {
    return prisma.bookmark.create({
      data: { recording_id: recordingId, label, timecode_ms: timecodeMs, note },
    });
  }

  async addAnnotation(
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
    return prisma.annotation.create({
      data: {
        recording_id: recordingId,
        timecode_ms: ann.timecodeMs,
        shape: ann.shape,
        geometry: ann.geometry,
        color: ann.color,
        text: ann.text,
        author: ann.author,
      },
    });
  }

  /**
   * End every still-open mark in these recordings at `timecodeMs`. Marks that
   * started after it, or were already closed, are left alone, so repeating a
   * clear changes nothing.
   */
  async clearAnnotations(recordingIds: string[], timecodeMs: number): Promise<number> {
    if (recordingIds.length === 0) return 0;
    const out = await prisma.annotation.updateMany({
      where: {
        recording_id: { in: recordingIds },
        end_timecode_ms: null,
        timecode_ms: { lte: timecodeMs },
      },
      data: { end_timecode_ms: timecodeMs },
    });
    return out.count;
  }
}
