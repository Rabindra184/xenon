import archiver from 'archiver';
import { Writable } from 'stream';
import { BundleEntry } from './BugReportService';

export function streamBundleToZip(entries: BundleEntry[], sink: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', reject);
    archive.on('end', () => resolve());
    archive.pipe(sink);
    for (const e of entries) {
      if (e.source.kind === 'buffer') {
        archive.append(e.source.data, { name: e.name });
      } else {
        archive.file(e.source.path, { name: e.name });
      }
    }
    archive.finalize().catch(reject);
  });
}
