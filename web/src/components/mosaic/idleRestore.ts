import { isSelfManualLock } from './manual-lock';

export interface RestoreDevice {
  udid: string;
  name?: string;
  busy?: boolean;
  session_id?: string | null;
  offline?: boolean;
}

export type SkipReason = 'in_use' | 'offline' | 'gone';

/**
 * Whether the idle timeout should run. Never during a recording: its release
 * stops the streams the recording reads from, and the recording is lost
 * (measured: FAILED, 28 bytes for 38 s).
 */
export function idleWatchEnabled(tileCount: number, recordingPhase: string): boolean {
  return tileCount > 0 && recordingPhase === 'idle';
}

/** Which released devices can come back, in their old order, and why the rest can't. */
export function planRestore<D extends RestoreDevice>(
  saved: { udid: string; name?: string }[],
  devices: D[],
  myUserId: string | null,
): { restore: D[]; skipped: { name: string; reason: SkipReason }[] } {
  const restore: D[] = [];
  const skipped: { name: string; reason: SkipReason }[] = [];
  for (const tile of saved) {
    const d = devices.find((x) => x.udid === tile.udid);
    const name = d?.name || tile.name || tile.udid;
    if (!d) skipped.push({ name, reason: 'gone' });
    else if (d.offline) skipped.push({ name, reason: 'offline' });
    else if (d.busy && !isSelfManualLock(d.session_id, d.udid, myUserId)) {
      skipped.push({ name, reason: 'in_use' });
    } else restore.push(d);
  }
  return { restore, skipped };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function releaseMessage(count: number, minutes: number): string {
  return `Released ${plural(count, 'device')} after ${minutes} minutes without activity.`;
}

const SKIP_TEXT: Record<SkipReason, string> = {
  in_use: 'is now in use by someone else.',
  offline: 'is offline.',
  gone: 'is no longer connected.',
};

/** Null when everything came back (the banner closes). */
export function restoreMessage(
  restored: number,
  skipped: { name: string; reason: SkipReason }[],
): string | null {
  if (skipped.length === 0) return null;
  const head = restored > 0 ? `Restored ${plural(restored, 'device')}.` : 'No devices restored.';
  return [head, ...skipped.map((s) => `${s.name} ${SKIP_TEXT[s.reason]}`)].join(' ');
}
