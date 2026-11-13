import { Service } from 'typedi';
import { prisma } from '../../prisma';
import { phoneKey } from './recordedPhone';

export interface CreateRecordingInput {
  /** Explicit primary key — must match the ffmpeg session key / file path. */
  id: string;
  groupId: string;
  deviceUdid: string;
  deviceHost: string;
  filePath: string;
  sessionId: string | null;
  deviceSnapshot: string | null;
  /** Who started it (User.id). */
  startedBy?: string | null;
}

export interface FinalizeInput {
  status: 'STOPPED' | 'FAILED' | 'DISCARDED';
  durationMs?: number;
  sizeBytes?: number;
  failReason?: string;
}

/** What the library lists of each recording, beside its own columns. */
const LIBRARY_INCLUDE = {
  bookmarks: { select: { label: true } },
  _count: { select: { annotations: true } },
  Session: { select: { build_id: true } },
} as const;

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
        started_by: input.startedBy ?? undefined,
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

  /** In-progress recordings with their marks, for Live devices to pick back up. */
  async listActiveWithMarks() {
    return prisma.recording.findMany({
      where: { status: 'RECORDING' },
      include: { annotations: true },
    });
  }

  /**
   * The phone's in-progress recording and its group, or null, by udid and
   * host. stream/stop checks this: stopping the stream under a live
   * recording loses all of it.
   */
  async activeRecordingFor(
    udid: string,
    host: string,
  ): Promise<{ id: string; groupId: string } | null> {
    const rec = await prisma.recording.findFirst({
      where: { status: 'RECORDING', device_udid: udid, device_host: host },
      select: { id: true, group_id: true },
    });
    return rec ? { id: rec.id, groupId: rec.group_id } : null;
  }

  /**
   * Whether a phone, by udid and host, has an in-progress recording. Another
   * server's phone of the same udid (an emulator's name repeats) is another
   * phone.
   */
  async isRecording(udid: string, host: string): Promise<boolean> {
    const count = await prisma.recording.count({
      where: { status: 'RECORDING', device_udid: udid, device_host: host },
    });
    return count > 0;
  }

  async listGroup(groupId: string) {
    return prisma.recording.findMany({
      where: { group_id: groupId },
      // The observed session's build, for the recording page's link to it.
      include: { bookmarks: true, annotations: true, Session: { select: { build_id: true } } },
    });
  }

  /**
   * A group's rows without their bookmarks and marks: which phone (udid and
   * host), when and by whom. Enough to decide the group's owner, and cheap enough for every
   * Range request of a video.
   */
  async listGroupStarts(groupId: string) {
    return prisma.recording.findMany({
      where: { group_id: groupId },
      select: {
        id: true,
        group_id: true,
        device_udid: true,
        device_host: true,
        started_at: true,
        started_by: true,
      },
    });
  }

  /**
   * One recording without its bookmarks and marks: what serving its video,
   * and deciding who may see it (its phone is its udid and host), needs. The player reads it on every Range
   * request.
   */
  async findVideo(id: string) {
    return prisma.recording.findUnique({
      where: { id },
      select: {
        id: true,
        group_id: true,
        device_udid: true,
        device_host: true,
        file_path: true,
        status: true,
        started_at: true,
        started_by: true,
      },
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

  /**
   * Every recording, with what the library lists: bookmark labels, a mark
   * count and the observed session's build.
   */
  async libraryRows() {
    return prisma.recording.findMany({ include: LIBRARY_INCLUDE });
  }

  /**
   * As libraryRows, for the groups only where a recording observed this
   * session: every row of each such group (its owner and summary are decided
   * on all of them). The session page asks on every view, and a scan of the
   * whole library per view grows with every recording kept.
   */
  async libraryRowsForSession(sessionId: string) {
    const observed = await prisma.recording.findMany({
      where: { session_id: sessionId },
      select: { group_id: true },
      distinct: ['group_id'],
    });
    if (observed.length === 0) return [];
    return prisma.recording.findMany({
      where: { group_id: { in: observed.map((r) => r.group_id) } },
      include: LIBRARY_INCLUDE,
    });
  }

  /**
   * Delete a group's rows, or only those of `ids` that are in the group;
   * bookmarks and annotations cascade. Returns how many went.
   */
  async deleteGroupRows(groupId: string, ids?: string[]): Promise<number> {
    const out = await prisma.recording.deleteMany({
      where: { group_id: groupId, ...(ids ? { id: { in: ids } } : {}) },
    });
    return out.count;
  }

  /**
   * What to call the phones of these udids (each Device row's marketing name,
   * else its own name), keyed by `udid@host` (phoneKey). A udid only one row
   * has is also keyed by the bare udid, so a recording that carries another
   * host for that phone (the server's address changed since) keeps its name.
   * A udid two servers have names only the recordings of its two hosts.
   */
  async deviceNames(
    udids: string[],
  ): Promise<Map<string, { name: string; platform: string | null }>> {
    const out = new Map<string, { name: string; platform: string | null }>();
    if (udids.length === 0) return out;
    const rows = await prisma.device.findMany({
      where: { udid: { in: udids } },
      select: { udid: true, host: true, name: true, marketingName: true, platform: true },
    });
    const perUdid = new Map<string, number>();
    rows.forEach((d) => perUdid.set(d.udid, (perUdid.get(d.udid) ?? 0) + 1));
    rows.forEach((d) => {
      const name = d.marketingName?.trim() || (d.name && d.name !== 'unknown' ? d.name : d.udid);
      const entry = {
        name,
        platform: d.platform && d.platform !== 'unknown' ? d.platform : null,
      };
      out.set(phoneKey({ udid: d.udid, host: d.host }), entry);
      if (perUdid.get(d.udid) === 1) out.set(d.udid, entry);
    });
    return out;
  }

  /** What to call each user: their name, else their email. */
  async userNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const rows = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
    rows.forEach((u) => out.set(u.id, u.name?.trim() || u.email));
    return out;
  }
}
