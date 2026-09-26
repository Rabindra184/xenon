import prettyMilliseconds from 'pretty-ms';
import { formatReservationRemaining } from './reservationTime';

/**
 * One state per device, used by the card and by the Devices filters alike.
 *
 * The card and the filters used to decide separately. A device in maintenance
 * rendered as a red "Error" and matched no filter: All 7 while the filters
 * added up to 6. Ranked most-blocking first, so a device that is both in
 * maintenance and running a test reads "maintenance" (the test still shows on
 * the card).
 */
export type DeviceState = 'ready' | 'busy' | 'reserved' | 'maintenance' | 'offline';

/** Filter order on the Devices page. */
export const DEVICE_STATES: DeviceState[] = ['ready', 'busy', 'reserved', 'maintenance', 'offline'];

export interface DeviceStateInput {
  udid: string;
  offline: boolean;
  userBlocked: boolean;
  busy: boolean;
  session_id?: string | null;
  reservedBy?: string;
  reservedUntil?: number;
  sessionStartTime?: number;
}

export interface Viewer {
  userId?: string | null;
  email?: string | null;
  name?: string | null;
  role?: string | null;
}

export function deviceState(d: DeviceStateInput, now: number): DeviceState {
  if (d.offline) return 'offline';
  if (d.userBlocked) return 'maintenance';
  if (d.busy) return 'busy';
  if (d.reservedUntil && now < d.reservedUntil) return 'reserved';
  return 'ready';
}

type Holder = 'session' | 'self' | 'other' | null;

/**
 * Who holds a busy device. A manual lock is `manual_<userId>_<udid>`; the
 * legacy `manual_<udid>` names no one, so it counts as someone else's.
 */
function holder(d: DeviceStateInput, viewer: Viewer | null): Holder {
  if (!d.busy || !d.session_id) return null;
  const id = String(d.session_id);
  if (!id.startsWith('manual_')) return 'session';
  return viewer?.userId && id === `manual_${viewer.userId}_${d.udid}` ? 'self' : 'other';
}

const isAdmin = (viewer: Viewer | null) =>
  viewer?.role === 'ADMIN' || viewer?.role === 'SUPER_ADMIN';

/**
 * What the device is doing, in words, or null when idle. Never an internal
 * id: the card used to print "SID · manual_u42" and "RES · <who>".
 */
export function activityLabel(
  d: DeviceStateInput,
  viewer: Viewer | null,
  now: number,
): string | null {
  switch (holder(d, viewer)) {
    case 'session':
      return d.sessionStartTime && d.sessionStartTime > 0 && now > d.sessionStartTime
        ? `Test session · ${prettyMilliseconds(now - d.sessionStartTime, { compact: true })}`
        : 'Test session running';
    case 'self':
      return 'Live control by you';
    case 'other':
      return 'Live control by another user';
  }
  if (d.reservedUntil && now < d.reservedUntil) {
    const mine =
      !!d.reservedBy && (d.reservedBy === viewer?.email || d.reservedBy === viewer?.name);
    const who = mine ? 'you' : d.reservedBy || 'another user';
    return `Reserved by ${who} · ${formatReservationRemaining(d.reservedUntil - now)} left`;
  }
  return null;
}

/**
 * Whether Control opens a usable device, and if not, the reason shown on the
 * card. The server refuses another user's device (409), so offering it only
 * led to a control page where every action failed. Admins are not refused by
 * the server for maintenance or another user's control, so neither is the card.
 */
export function controlAvailability(
  d: DeviceStateInput,
  viewer: Viewer | null,
): { enabled: true } | { enabled: false; reason: string } {
  if (d.offline) return { enabled: false, reason: 'Device is offline' };
  if (d.userBlocked && !isAdmin(viewer)) return { enabled: false, reason: 'In maintenance' };
  const h = holder(d, viewer);
  if (h === 'session') return { enabled: false, reason: 'A test is running on this device' };
  if (h === 'other' && !isAdmin(viewer)) {
    return { enabled: false, reason: 'Another user is controlling this device' };
  }
  return { enabled: true };
}
