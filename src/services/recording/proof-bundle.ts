import { Service, Container } from 'typedi';
import archiver, { Archiver } from 'archiver';
import * as fs from 'fs';
import { RecordingStore } from './recording-store';
import {
  compositeOutputPath,
  compositeLayoutPath,
  compositePartFileName,
  listCompositeParts,
  readCompositeEnded,
  type CompositeEndedFile,
  type CompositeLayoutFile,
} from './RecordingOrchestrator';

/** A composite part a download carries, and how it ended. */
export interface ServedCompositePart {
  part: number;
  /** Its name on disk and in the zips: composite.mp4, composite-2.mp4, ... */
  file: string;
  /** Its ffmpeg ended on its own (composite-ended.json), or null. */
  ended: CompositeEndedFile | null;
}

/**
 * A zip whose files go in in the order they were added: archiver stats up to
 * four files at once and adds each as its stat answers, so composite-2.mp4
 * could come before composite.mp4.
 */
function newZip(): Archiver {
  return archiver('zip', { zlib: { level: 6 }, statConcurrency: 1 });
}

/** Safe zip / download filename fragment from a UDID. */
export function safeVideoFileStem(udid: string): string {
  const cleaned = String(udid || 'device')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 64) || 'device';
}

/** A host as a name fragment: `http://node.test:4723` is `node.test-4723`. */
function safeHostStem(host: unknown): string {
  return (
    String(host ?? '')
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'host'
  );
}

/**
 * What to call each recording's phone in a zip, from `stem` (its udid as a
 * name). A udid the zip has once keeps its plain name. A udid it has more than
 * once (two servers name a phone alike) gets its host as well,
 * `emulator-5554@node.test-4723`, so neither phone's files replace the other's.
 */
function phoneEntryNames<R extends { device_udid: string; device_host?: string | null }>(
  rows: R[],
  stem: (udid: string) => string,
): Map<R, string> {
  const count = new Map<string, number>();
  rows.forEach((r) => count.set(r.device_udid, (count.get(r.device_udid) ?? 0) + 1));
  const out = new Map<R, string>();
  const taken = new Set<string>();
  rows.forEach((r) => {
    const base =
      (count.get(r.device_udid) ?? 0) > 1
        ? `${stem(r.device_udid)}@${safeHostStem(r.device_host)}`
        : stem(r.device_udid);
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    taken.add(name);
    out.set(r, name);
  });
  return out;
}

/**
 * Which of a group's recordings a download may carry. `undefined` means every
 * one of them (an admin); otherwise only the listed recording ids, which the
 * route has already filtered to the devices the caller can see.
 */
export type RecordingFilter = string[] | undefined;

/**
 * The group's rows as the caller already read them (`RecordingStore.listGroup`),
 * so a download works from the same snapshot its visibility was decided on
 * instead of reading the group a second time. Omitted, the service reads it.
 */
export type GroupRows = ReadonlyArray<any> | undefined;

/**
 * Builds a self-contained zip for one recording group: manifest, README,
 * per-device subdirs with video.mp4, bookmarks.json, annotations.json,
 * device.json. Reuses archiver — same dependency the existing bug-report
 * primitives use; no new deps.
 */
@Service()
export class ProofBundleService {
  constructor(
    private readonly store: RecordingStore = Container.get(RecordingStore),
  ) {}

  /**
   * Returns an Archiver instance the caller pipes into a writable stream
   * (e.g., the HTTP response). The archive is finalized inside `populate`.
   */
  streamBundleZip(
    groupId: string,
    onlyRecordingIds?: RecordingFilter,
    groupRows?: GroupRows,
  ): Archiver {
    const archive = newZip();
    this.populate(archive, groupId, onlyRecordingIds, groupRows).catch((err) =>
      archive.emit('error', err),
    );
    return archive;
  }

  /**
   * Videos-only zip: one `<udid>.mp4` per device (when present on disk), plus
   * each part of the mosaic composite the caller may have (`composite.mp4`,
   * then `composite-2.mp4`, ...). No manifest / JSON extras.
   * Throws Error('no_videos') when nothing playable exists.
   */
  async buildVideosZip(
    groupId: string,
    onlyRecordingIds?: RecordingFilter,
    groupRows?: GroupRows,
  ): Promise<Archiver> {
    const entries = await this.collectVideoEntries(groupId, onlyRecordingIds, groupRows);
    if (entries.length === 0) {
      throw Object.assign(new Error('no_videos'), { code: 'no_videos' as const });
    }
    const archive = newZip();
    for (const e of entries) {
      archive.file(e.filePath, { name: e.name });
    }
    void archive.finalize();
    return archive;
  }

  /** @deprecated Prefer {@link buildVideosZip} — kept for call-site clarity. */
  streamVideosZip(
    groupId: string,
    onlyRecordingIds?: RecordingFilter,
    groupRows?: GroupRows,
  ): Archiver {
    const archive = newZip();
    this.populateVideosOnly(archive, groupId, onlyRecordingIds, groupRows).catch((err) =>
      archive.emit('error', err),
    );
    return archive;
  }

  /**
   * Whether a caller limited to `only` may have a part of the group's
   * composite (part 1, composite.mp4, by default). It shows every phone in its
   * cells, so each of them must be visible. An admin (`only` undefined)
   * always may.
   *
   * The cells come from the part's layout (composite.json, composite-2.json,
   * ...), written when the part started. The group's current rows are no
   * stand-in for them: retention purges rows one at a time while the
   * composite lives on, and each part has the phones recording when it
   * started. So without a readable layout there is no telling who is in the
   * part, and only an admin gets it. (Layouts arrived on 2026-09-26;
   * composites older than that age out with their 30-day retention.)
   */
  compositeAllowed(groupId: string, only: RecordingFilter, part = 1): boolean {
    if (only === undefined) return true;
    const allowed = new Set(only);
    try {
      const layout = JSON.parse(
        fs.readFileSync(compositeLayoutPath(groupId, part), 'utf8'),
      ) as Partial<CompositeLayoutFile>;
      const cells = Array.isArray(layout.cells) ? layout.cells : [];
      return (
        cells.length > 0 &&
        cells.every((c) => typeof c?.recordingId === 'string' && allowed.has(c.recordingId))
      );
    } catch {
      // No layout file, an unreadable one, or no ArtifactStore (unit tests).
      return false;
    }
  }

  /** The group's recordings narrowed to `only`: all a download may carry. */
  private async listVisible(
    groupId: string,
    only: RecordingFilter,
    groupRows?: GroupRows,
  ): Promise<{ recordings: any[] }> {
    const all = [...(groupRows ?? (await this.store.listGroup(groupId)))] as any[];
    if (only === undefined) return { recordings: all };
    const allowed = new Set(only);
    return { recordings: all.filter((r) => allowed.has(r.id)) };
  }

  /**
   * Whether the group has a composite a download would serve: a file with
   * something in it, as resolveCompositeFile asks. The summaries offer the
   * Side-by-side download by this; through 2.36 they asked only whether the
   * file existed, so a composite whose ffmpeg died before writing anything
   * was offered and then refused.
   */
  hasCompositeFile(groupId: string, part = 1): boolean {
    try {
      const file = compositeOutputPath(groupId, part);
      return fs.existsSync(file) && fs.statSync(file).size > 0;
    } catch {
      return false; // ArtifactStore unset (unit tests)
    }
  }

  /**
   * The parts of the group's composite a caller limited to `only` may have,
   * in order: each with something in it (hasCompositeFile) and showing only
   * phones they see (compositeAllowed). Every download and summary offers
   * these. Through 2.36 a group had one composite, which an added phone was
   * never in.
   */
  servableCompositeParts(groupId: string, only: RecordingFilter): ServedCompositePart[] {
    return listCompositeParts(groupId)
      .filter((part) => this.hasCompositeFile(groupId, part))
      .filter((part) => this.compositeAllowed(groupId, only, part))
      .map((part) => ({
        part,
        file: compositePartFileName(part),
        ended: readCompositeEnded(groupId, part),
      }));
  }

  /**
   * A part of the composite (part 1 by default) as every download gets it:
   * with the devices' marks burned in when that render works, otherwise raw.
   * Null when the group has no such part (single-device groups never do).
   */
  async resolveCompositeFile(groupId: string, part = 1): Promise<string | null> {
    let compositePath: string;
    try {
      compositePath = compositeOutputPath(groupId, part);
    } catch {
      return null; // ArtifactStore unset (unit tests)
    }
    if (!fs.existsSync(compositePath) || fs.statSync(compositePath).size === 0) return null;
    try {
      const { AnnotationRenderService } = await import('./annotation-render');
      return (await Container.get(AnnotationRenderService).resolveCompositePath(groupId, part))
        .filePath;
    } catch (err: any) {
      const { default: log } = await import('../../logger');
      log
        .scope('ProofBundle')
        .warn(`Composite burn-in skipped for ${groupId}: ${err?.message ?? err}`);
      return compositePath;
    }
  }

  private async collectVideoEntries(
    groupId: string,
    only?: RecordingFilter,
    groupRows?: GroupRows,
  ): Promise<Array<{ filePath: string; name: string }>> {
    const { recordings } = await this.listVisible(groupId, only, groupRows);
    const entries: Array<{ filePath: string; name: string }> = [];

    for (const { part, file } of this.servableCompositeParts(groupId, only)) {
      const composite = await this.resolveCompositeFile(groupId, part);
      if (composite) entries.push({ filePath: composite, name: file });
    }

    const names = phoneEntryNames(recordings as any[], safeVideoFileStem);
    for (const r of recordings) {
      try {
        if (r.file_path && fs.existsSync(r.file_path) && fs.statSync(r.file_path).size > 0) {
          let filePath = r.file_path as string;
          try {
            const { AnnotationRenderService } = await import('./annotation-render');
            const rendered = await Container.get(AnnotationRenderService).resolvePlayablePath(
              r.id,
            );
            filePath = rendered.filePath;
          } catch {
            /* keep clean source */
          }
          entries.push({
            filePath,
            name: `${names.get(r)}.mp4`,
          });
        }
      } catch {
        /* skip */
      }
    }
    return entries;
  }

  /**
   * Resolve a playable on-disk mp4 for download, among the recordings
   * `onlyRecordingIds` allows (every one when undefined).
   * - With a phone: that phone's recording in the group, by udid and, when
   *   given, host (two servers can report a phone of one udid; the router
   *   refuses a udid two of the recordings share before asking without one).
   * - Without: the sole playable recording if exactly one allowed recording
   *   has a file; otherwise null (caller should use videos.zip).
   * When the recording has annotations, returns the burned-in annotated file.
   */
  async resolveVideoFile(
    groupId: string,
    phone?: { udid: string; host?: string },
    onlyRecordingIds?: RecordingFilter,
    groupRows?: GroupRows,
  ): Promise<{ filePath: string; downloadName: string; recordingId?: string } | null> {
    const { recordings } = await this.listVisible(groupId, onlyRecordingIds, groupRows);
    const playable = recordings.filter((r) => {
      try {
        return r.file_path && fs.existsSync(r.file_path) && fs.statSync(r.file_path).size > 0;
      } catch {
        return false;
      }
    });
    let hit: any;
    if (phone) {
      hit = playable.find(
        (r) =>
          r.device_udid === phone.udid &&
          (phone.host === undefined || (r.device_host ?? '127.0.0.1') === phone.host),
      );
    } else if (playable.length === 1) {
      hit = playable[0];
    } else {
      return null;
    }
    if (!hit) return null;

    let filePath = hit.file_path as string;
    try {
      const { AnnotationRenderService } = await import('./annotation-render');
      const rendered = await Container.get(AnnotationRenderService).resolvePlayablePath(hit.id);
      filePath = rendered.filePath;
    } catch (err: any) {
      // Fall back to the clean source if burn-in fails.
      const { default: log } = await import('../../logger');
      log.scope('ProofBundle').warn(
        `Annotation burn-in skipped for ${hit.id}: ${err?.message ?? err}`,
      );
    }

    return {
      filePath,
      downloadName: `${safeVideoFileStem(hit.device_udid)}.mp4`,
      recordingId: hit.id,
    };
  }

  private async populateVideosOnly(
    archive: Archiver,
    groupId: string,
    only?: RecordingFilter,
    groupRows?: GroupRows,
  ): Promise<void> {
    const entries = await this.collectVideoEntries(groupId, only, groupRows);
    if (entries.length === 0) {
      archive.emit('error', new Error('no_videos'));
      return;
    }
    for (const e of entries) {
      archive.file(e.filePath, { name: e.name });
    }
    await archive.finalize();
  }

  private async populate(
    archive: Archiver,
    groupId: string,
    only?: RecordingFilter,
    groupRows?: GroupRows,
  ): Promise<void> {
    const { recordings } = await this.listVisible(groupId, only, groupRows);

    // Mosaic-wide composite mp4s (only present for multi-device groups), in
    // parts when phones were added, each only for a caller who may see every
    // device in it.
    const composites: Array<ServedCompositePart & { filePath: string }> = [];
    for (const served of this.servableCompositeParts(groupId, only)) {
      const filePath = await this.resolveCompositeFile(groupId, served.part);
      if (filePath) composites.push({ ...served, filePath });
    }
    // A part whose ffmpeg ended on its own covers the group only up to then;
    // the bundle says so rather than pass it off as the whole group.
    const ended = composites.find((c) => c.ended)?.ended ?? null;
    const describe = (ended: CompositeEndedFile | null) =>
      ended
        ? { endedEarly: true, exitCode: ended.exitCode, endedAt: ended.endedAt }
        : { endedEarly: false };

    const manifest = {
      groupId,
      generatedAt: new Date().toISOString(),
      devices: (recordings as any[]).map((r) => ({
        udid: r.device_udid,
        recordingId: r.id,
        durationMs: r.duration_ms,
        sizeBytes: r.size_bytes,
        status: r.status,
        startedAt: r.started_at,
        endedAt: r.ended_at,
      })),
      // The whole side-by-side video, as before parts: ended early if any part did.
      ...(composites.length > 0 ? { composite: describe(ended) } : {}),
      ...(composites.length > 1
        ? { compositeParts: composites.map((c) => ({ file: c.file, ...describe(c.ended) })) }
        : {}),
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.append(this.renderReadme(groupId, recordings as any[], composites), {
      name: 'README.md',
    });

    for (const c of composites) archive.file(c.filePath, { name: c.file });

    const folders = phoneEntryNames(recordings as any[], (udid) => udid);
    for (const r of recordings as any[]) {
      const base = `devices/${folders.get(r)}`;
      if (r.file_path && fs.existsSync(r.file_path)) {
        archive.file(r.file_path, { name: `${base}/video.mp4` });
      }
      archive.append(JSON.stringify(r.bookmarks ?? [], null, 2), {
        name: `${base}/bookmarks.json`,
      });
      archive.append(JSON.stringify(r.annotations ?? [], null, 2), {
        name: `${base}/annotations.json`,
      });
      archive.append(
        JSON.stringify(
          {
            udid: r.device_udid,
            host: r.device_host,
            sessionId: r.session_id,
            snapshot: r.device_snapshot,
            startedAt: r.started_at,
            endedAt: r.ended_at,
            status: r.status,
            failReason: r.fail_reason,
          },
          null,
          2,
        ),
        { name: `${base}/device.json` },
      );
    }
    await archive.finalize();
  }

  private renderReadme(
    groupId: string,
    recordings: any[],
    composites: ServedCompositePart[] = [],
  ): string {
    const lines: string[] = [];
    lines.push(`# Proof Bundle ${groupId}`);
    lines.push('');
    lines.push(`Generated ${new Date().toISOString()}`);
    lines.push('');
    const several = composites.length > 1;
    const endedParts = composites.filter((c) => c.ended);
    if (several || endedParts.length > 0) {
      lines.push('## Composite');
      if (several) {
        const files = composites.map((c) => c.file).join(', then ');
        lines.push(
          `The side-by-side video is in ${composites.length} parts: ${files}. A new part starts each time a device was added to the recording, with every device recording then.`,
        );
      }
      for (const c of endedParts) {
        lines.push(
          `The side-by-side ${c.file} ended on its own at ${c.ended?.endedAt}, before the recording stopped${
            several ? ' or the next part began' : ''
          }, so it covers the devices only up to then. Each device's own video.mp4 runs to the end.`,
        );
      }
      lines.push('');
    }
    lines.push('## Devices');
    for (const r of recordings) {
      lines.push(
        `- **${r.device_udid}** — status=${r.status}, duration=${r.duration_ms ?? '?'}ms, size=${r.size_bytes ?? '?'}B`,
      );
    }
    lines.push('');
    lines.push('## Bookmarks');
    let any = false;
    for (const r of recordings) {
      for (const b of r.bookmarks ?? []) {
        any = true;
        lines.push(
          `- [${r.device_udid} @ ${b.timecode_ms}ms] **${b.label}**${b.note ? ` — ${b.note}` : ''}`,
        );
      }
    }
    if (!any) lines.push('_(none)_');
    return lines.join('\n');
  }
}
