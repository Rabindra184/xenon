import { isSelfManualLock } from './manual-lock';
import { gridCanChange, type RecordingPhase } from './recording-group-store';
import { samePhone, type PhoneRef } from '../../lib/phone';

export interface RestoreDevice {
  udid: string;
  host: string;
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
export function idleWatchEnabled(tileCount: number, recordingPhase: RecordingPhase): boolean {
  return tileCount > 0 && gridCanChange({ recordingPhase });
}

/**
 * Which released devices can come back, in their old order, and why the rest
 * can't. Each tile comes back from its own phone's row: two servers can each
 * have a phone of one udid.
 */
export function planRestore<D extends RestoreDevice>(
  saved: Array<PhoneRef & { name?: string }>,
  devices: D[],
  myUserId: string | null,
): { restore: D[]; skipped: { name: string; reason: SkipReason }[] } {
  const restore: D[] = [];
  const skipped: { name: string; reason: SkipReason }[] = [];
  for (const tile of saved) {
    const d = devices.find((x) => samePhone(x, tile));
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
