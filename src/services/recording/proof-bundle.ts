import { Service, Container } from 'typedi';
import archiver, { Archiver } from 'archiver';
import * as fs from 'fs';
import { RecordingStore } from './recording-store';
import {
  compositeOutputPath,
  compositeLayoutPath,
  type CompositeLayoutFile,
} from './RecordingOrchestrator';

/** Safe zip / download filename fragment from a UDID. */
export function safeVideoFileStem(udid: string): string {
  const cleaned = String(udid || 'device')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 64) || 'device';
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
    const archive = archiver('zip', { zlib: { level: 6 } });
    this.populate(archive, groupId, onlyRecordingIds, groupRows).catch((err) =>
      archive.emit('error', err),
    );
    return archive;
  }

  /**
   * Videos-only zip: one `<udid>.mp4` per device (when present on disk), plus
   * `composite.mp4` when the mosaic composite exists. No manifest / JSON extras.
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
    const archive = archiver('zip', { zlib: { level: 6 } });
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
    const archive = archiver('zip', { zlib: { level: 6 } });
    this.populateVideosOnly(archive, groupId, onlyRecordingIds, groupRows).catch((err) =>
      archive.emit('error', err),
    );
    return archive;
  }

  /**
   * Whether a caller limited to `only` may have the group's composite. It
   * shows every phone in its cells, so each of them must be visible. An
   * admin (`only` undefined) always may.
   *
   * The cells come from composite.json, written when the composite started.
   * The group's current rows are no stand-in for them: retention purges rows
   * one at a time while the composite lives on, and a device added later
   * never joins the composite. Only a composite with no layout file (older
   * than composite.json, or its write failed) falls back to "sees every
   * current row". A layout file that cannot be read denies.
   */
  compositeAllowed(
    groupId: string,
    only: RecordingFilter,
    groupRows: ReadonlyArray<{ id: string }>,
  ): boolean {
    if (only === undefined) return true;
    const allowed = new Set(only);
    let layoutPath: string;
    try {
      layoutPath = compositeLayoutPath(groupId);
    } catch {
      return false; // ArtifactStore unset (unit tests): there is no composite either
    }
    if (!fs.existsSync(layoutPath)) return groupRows.every((r) => allowed.has(r.id));
    try {
      const layout = JSON.parse(
        fs.readFileSync(layoutPath, 'utf8'),
      ) as Partial<CompositeLayoutFile>;
      const cells = Array.isArray(layout.cells) ? layout.cells : [];
      return (
        cells.length > 0 &&
        cells.every((c) => typeof c?.recordingId === 'string' && allowed.has(c.recordingId))
      );
    } catch {
      return false;
    }
  }

  /**
   * The whole group (`all`, for {@link compositeAllowed}) and its recordings
   * narrowed to `only`, which is all a download may carry.
   */
  private async listVisible(
    groupId: string,
    only: RecordingFilter,
    groupRows?: GroupRows,
  ): Promise<{ all: any[]; recordings: any[] }> {
    const all = [...(groupRows ?? (await this.store.listGroup(groupId)))] as any[];
    if (only === undefined) return { all, recordings: all };
    const allowed = new Set(only);
    return { all, recordings: all.filter((r) => allowed.has(r.id)) };
  }

  /**
   * The composite every download gets: with the devices' marks burned in when
   * that render works, otherwise the raw composite. Null when the group has
   * none (single-device groups never do).
   */
  async resolveCompositeFile(groupId: string): Promise<string | null> {
    let compositePath: string;
    try {
      compositePath = compositeOutputPath(groupId);
    } catch {
      return null; // ArtifactStore unset (unit tests)
    }
    if (!fs.existsSync(compositePath) || fs.statSync(compositePath).size === 0) return null;
    try {
      const { AnnotationRenderService } = await import('./annotation-render');
      return (await Container.get(AnnotationRenderService).resolveCompositePath(groupId)).filePath;
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
    const { all, recordings } = await this.listVisible(groupId, only, groupRows);
    const entries: Array<{ filePath: string; name: string }> = [];

    const composite = this.compositeAllowed(groupId, only, all)
      ? await this.resolveCompositeFile(groupId)
      : null;
    if (composite) entries.push({ filePath: composite, name: 'composite.mp4' });

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
            name: `${safeVideoFileStem(r.device_udid)}.mp4`,
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
   * - With `udid`: that device's recording in the group.
   * - Without: the sole playable recording if exactly one allowed recording
   *   has a file; otherwise null (caller should use videos.zip).
   * When the recording has annotations, returns the burned-in annotated file.
   */
  async resolveVideoFile(
    groupId: string,
    udid?: string,
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
    if (udid) {
      hit = playable.find((r) => r.device_udid === udid);
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
    const { all, recordings } = await this.listVisible(groupId, only, groupRows);

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
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.append(this.renderReadme(groupId, recordings as any[]), {
      name: 'README.md',
    });

    // Mosaic-wide composite mp4 (only present for multi-device groups), and
    // only for a caller who may see every device in it.
    const composite = this.compositeAllowed(groupId, only, all)
      ? await this.resolveCompositeFile(groupId)
      : null;
    if (composite) archive.file(composite, { name: 'composite.mp4' });

    for (const r of recordings as any[]) {
      const base = `devices/${r.device_udid}`;
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

  private renderReadme(groupId: string, recordings: any[]): string {
    const lines: string[] = [];
    lines.push(`# Proof Bundle ${groupId}`);
    lines.push('');
    lines.push(`Generated ${new Date().toISOString()}`);
    lines.push('');
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
