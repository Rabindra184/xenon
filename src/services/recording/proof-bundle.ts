import { Service, Container } from 'typedi';
import archiver, { Archiver } from 'archiver';
import * as fs from 'fs';
import { RecordingStore } from './recording-store';
import { compositeOutputPath } from './RecordingOrchestrator';

/** Safe zip / download filename fragment from a UDID. */
export function safeVideoFileStem(udid: string): string {
  const cleaned = String(udid || 'device')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 64) || 'device';
}

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
  streamBundleZip(groupId: string): Archiver {
    const archive = archiver('zip', { zlib: { level: 6 } });
    this.populate(archive, groupId).catch((err) => archive.emit('error', err));
    return archive;
  }

  /**
   * Videos-only zip: one `<udid>.mp4` per device (when present on disk), plus
   * `composite.mp4` when the mosaic composite exists. No manifest / JSON extras.
   * Throws Error('no_videos') when nothing playable exists.
   */
  async buildVideosZip(groupId: string): Promise<Archiver> {
    const entries = await this.collectVideoEntries(groupId);
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
  streamVideosZip(groupId: string): Archiver {
    const archive = archiver('zip', { zlib: { level: 6 } });
    this.populateVideosOnly(archive, groupId).catch((err) => archive.emit('error', err));
    return archive;
  }

  private async collectVideoEntries(
    groupId: string,
  ): Promise<Array<{ filePath: string; name: string }>> {
    const recordings = (await this.store.listGroup(groupId)) as any[];
    const entries: Array<{ filePath: string; name: string }> = [];

    try {
      const compositePath = compositeOutputPath(groupId);
      if (fs.existsSync(compositePath) && fs.statSync(compositePath).size > 0) {
        entries.push({ filePath: compositePath, name: 'composite.mp4' });
      }
    } catch {
      /* ArtifactStore may be unset in unit tests; skip composite. */
    }

    for (const r of recordings) {
      try {
        if (r.file_path && fs.existsSync(r.file_path) && fs.statSync(r.file_path).size > 0) {
          entries.push({
            filePath: r.file_path,
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
   * Resolve a playable on-disk mp4 for download.
   * - With `udid`: that device's recording in the group.
   * - Without: the sole playable recording if the group has exactly one file;
   *   otherwise null (caller should use videos.zip).
   */
  async resolveVideoFile(
    groupId: string,
    udid?: string,
  ): Promise<{ filePath: string; downloadName: string } | null> {
    const recordings = (await this.store.listGroup(groupId)) as any[];
    const playable = recordings.filter((r) => {
      try {
        return r.file_path && fs.existsSync(r.file_path) && fs.statSync(r.file_path).size > 0;
      } catch {
        return false;
      }
    });
    if (udid) {
      const hit = playable.find((r) => r.device_udid === udid);
      if (!hit) return null;
      return {
        filePath: hit.file_path,
        downloadName: `${safeVideoFileStem(hit.device_udid)}.mp4`,
      };
    }
    if (playable.length === 1) {
      const hit = playable[0];
      return {
        filePath: hit.file_path,
        downloadName: `${safeVideoFileStem(hit.device_udid)}.mp4`,
      };
    }
    return null;
  }

  private async populateVideosOnly(archive: Archiver, groupId: string): Promise<void> {
    const entries = await this.collectVideoEntries(groupId);
    if (entries.length === 0) {
      archive.emit('error', new Error('no_videos'));
      return;
    }
    for (const e of entries) {
      archive.file(e.filePath, { name: e.name });
    }
    await archive.finalize();
  }

  private async populate(archive: Archiver, groupId: string): Promise<void> {
    const recordings = await this.store.listGroup(groupId);

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

    // Mosaic-wide composite mp4 (only present for multi-device groups).
    const compositePath = compositeOutputPath(groupId);
    if (fs.existsSync(compositePath)) {
      archive.file(compositePath, { name: 'composite.mp4' });
    }

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
