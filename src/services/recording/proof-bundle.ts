import { Service, Container } from 'typedi';
import archiver, { Archiver } from 'archiver';
import * as fs from 'fs';
import { RecordingStore } from './recording-store';
import { compositeOutputPath } from './RecordingOrchestrator';

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
