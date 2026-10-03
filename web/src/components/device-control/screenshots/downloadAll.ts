import { zipSync } from 'fflate';
import { captureFilename } from './captureMeta';
import { blobBytes } from './imageTools';

/** Names in order, a repeat getting "-2", "-3" before its extension. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)}-${count}${name.slice(dot)}` : `${name}-${count}`;
  });
}

interface Zippable {
  n: number;
  takenAt: number;
  png: Blob;
  markedFrom?: number;
}

/**
 * One zip of every capture, under the names Download gives them. Stored, not
 * compressed: PNGs already are, and level 0 keeps a 50-capture zip instant.
 */
export async function capturesZip(deviceName: string, captures: Zippable[]): Promise<Blob> {
  const names = uniqueNames(captures.map((c) => captureFilename(deviceName, c)));
  const entries: Record<string, Uint8Array> = {};
  const bytes = await Promise.all(captures.map((c) => blobBytes(c.png)));
  names.forEach((name, i) => {
    entries[name] = bytes[i];
  });
  const zipped = zipSync(entries, { level: 0 });
  return new Blob([zipped], { type: 'application/zip' });
}

/** Hands the browser a file to save. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking in the same task can cancel a download that hasn't started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
