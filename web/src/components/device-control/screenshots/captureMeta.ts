/** What a capture is called and how its files are named. Pure, no DOM. */

export interface CaptureFacts {
  /** The phone's own number for it: "Screenshot 12". */
  n: number;
  takenAt: number;
  width: number;
  height: number;
  bytes: number;
  /** Set on a marked copy: the number of the capture it was drawn on. */
  markedFrom?: number;
}

export function captureLabel(c: Pick<CaptureFacts, 'n'>): string {
  return `Screenshot ${c.n}`;
}

const pad = (v: number) => String(v).padStart(2, '0');

function clock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "Today 14:32:05", or "3 Oct 2026 14:32:05" for another day. */
export function timeText(at: number, now: number = Date.now()): string {
  const d = new Date(at);
  if (sameDay(d, new Date(now))) return `Today ${clock(d)}`;
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${date} ${clock(d)}`;
}

export function orientationOf(width: number, height: number): '' | 'Portrait' | 'Landscape' {
  if (!width || !height) return '';
  return width > height ? 'Landscape' : 'Portrait';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Screenshot 12 · Today 14:32:05 · Portrait · 1440 × 2960 · 1.2 MB" */
export function detailsLine(c: CaptureFacts, now: number = Date.now()): string {
  const parts = [captureLabel(c)];
  if (c.markedFrom !== undefined) parts.push(`marked copy of ${c.markedFrom}`);
  parts.push(timeText(c.takenAt, now));
  const orientation = orientationOf(c.width, c.height);
  if (orientation) parts.push(orientation, `${c.width} × ${c.height}`);
  parts.push(formatBytes(c.bytes));
  return parts.join(' · ');
}

/** The device's name as a file-name part: lower case letters, digits and dashes. */
export function deviceSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'device';
}

function stamp(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** galaxy-s9-screenshot-12-2026-10-03-14-32-05.png */
export function captureFilename(
  deviceName: string,
  c: Pick<CaptureFacts, 'n' | 'takenAt' | 'markedFrom'>,
): string {
  const d = new Date(c.takenAt);
  const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const marked = c.markedFrom !== undefined ? '-marked' : '';
  return `${deviceSlug(deviceName)}-screenshot-${c.n}${marked}-${stamp(c.takenAt)}-${time}.png`;
}

/** galaxy-s9-screenshots-2026-10-03.zip */
export function zipFilename(deviceName: string, at: number = Date.now()): string {
  return `${deviceSlug(deviceName)}-screenshots-${stamp(at)}.zip`;
}
