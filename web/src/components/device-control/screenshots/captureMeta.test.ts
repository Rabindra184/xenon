import { describe, expect, it } from 'vitest';
import {
  captureFilename,
  captureLabel,
  detailsLine,
  deviceSlug,
  formatBytes,
  orientationOf,
  timeText,
  zipFilename,
} from './captureMeta';

// 2026-10-03 14:32:05 local time.
const taken = new Date(2026, 9, 3, 14, 32, 5).getTime();

describe('captureMeta', () => {
  it('labels a capture by its number', () => {
    expect(captureLabel({ n: 12 })).toBe('Screenshot 12');
  });

  it('says Today for a capture taken today, the date otherwise', () => {
    expect(timeText(taken, new Date(2026, 9, 3, 18, 0).getTime())).toBe('Today 14:32:05');
    const other = timeText(taken, new Date(2026, 9, 5, 9, 0).getTime());
    expect(other).toMatch(/14:32:05$/);
    expect(other).not.toMatch(/^Today/);
  });

  it('reads orientation from the picture', () => {
    expect(orientationOf(1440, 2960)).toBe('Portrait');
    expect(orientationOf(2960, 1440)).toBe('Landscape');
    expect(orientationOf(0, 0)).toBe('');
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1.25 * 1024 * 1024)).toBe('1.3 MB');
  });

  it('builds the details line, with a marked copy named', () => {
    const now = new Date(2026, 9, 3, 18, 0).getTime();
    const c = { n: 12, takenAt: taken, width: 1440, height: 2960, bytes: 1.2 * 1024 * 1024 };
    expect(detailsLine(c, now)).toBe(
      'Screenshot 12 · Today 14:32:05 · Portrait · 1440 × 2960 · 1.2 MB',
    );
    expect(detailsLine({ ...c, n: 13, markedFrom: 12 }, now)).toBe(
      'Screenshot 13 · marked copy of 12 · Today 14:32:05 · Portrait · 1440 × 2960 · 1.2 MB',
    );
    expect(detailsLine({ ...c, width: 0, height: 0 }, now)).toBe(
      'Screenshot 12 · Today 14:32:05 · 1.2 MB',
    );
  });

  it('reduces a device name to letters, digits and dashes', () => {
    expect(deviceSlug('Galaxy S9+ (SM-G965F)')).toBe('galaxy-s9-sm-g965f');
    expect(deviceSlug('  ')).toBe('device');
    expect(deviceSlug('../../etc')).toBe('etc');
  });

  it('names files after the device, number and time', () => {
    expect(captureFilename('Galaxy S9+', { n: 12, takenAt: taken })).toBe(
      'galaxy-s9-screenshot-12-2026-10-03-14-32-05.png',
    );
    expect(captureFilename('Galaxy S9+', { n: 13, takenAt: taken, markedFrom: 12 })).toBe(
      'galaxy-s9-screenshot-13-marked-2026-10-03-14-32-05.png',
    );
    expect(zipFilename('Galaxy S9+', taken)).toBe('galaxy-s9-screenshots-2026-10-03.zip');
  });
});
