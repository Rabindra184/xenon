import { gridCanChange, type MosaicState, type MosaicTile } from './recording-group-store';
import { isAmbiguousPhoneBody, isDeviceConflictBody } from '../../api-service/api-client';

/** A device as the Live Devices page reads it from GET /xenon/api/device. */
export interface DeviceRow {
  udid: string;
  /** The phone's server; with the udid, which phone this is. */
  host: string;
  name?: string;
  /** What people call it ("Galaxy S9+"), read from the device by the server. */
  marketingName?: string | null;
  platform?: string;
  busy?: boolean;
  session_id?: string;
  /** On a hub: the preview hold a node's phone's node reports. */
  nodeHold?: string | null;
  mjpegServerPort?: number;
  screenWidth?: string | number;
  screenHeight?: string | number;
  offline?: boolean;
}

/** The name to show: the friendly one, else today's name, else the udid. */
export function deviceLabel(d: {
  udid: string;
  name?: string;
  marketingName?: string | null;
}): string {
  return d.marketingName?.trim() || d.name || d.udid;
}

// Derive a CSS aspect-ratio string from device data.
// Prefers the WDA-reported screen dimensions (set during stream start);
// falls back to platform conventions (tvos/androidtv → 16:9, else 9:16).
export function tileAspect(d?: Partial<DeviceRow>): string {
  if (!d) return '9 / 16';
  const w = Number(d.screenWidth);
  const h = Number(d.screenHeight);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return `${w} / ${h}`;
  }
  const p = (d.platform || '').toLowerCase();
  if (p === 'tvos' || p === 'androidtv' || p === 'android-tv') return '16 / 9';
  return '9 / 16';
}

/** One tile builder for click-to-add, rehydration and Restore. */
export function tileFromDevice(d: DeviceRow): MosaicTile {
  const sw = Number(d.screenWidth);
  const sh = Number(d.screenHeight);
  return {
    udid: d.udid,
    host: d.host,
    name: deviceLabel(d),
    mjpegPort: 0,
    aspect: tileAspect(d),
    screenWidth: Number.isFinite(sw) && sw > 0 ? sw : undefined,
    screenHeight: Number.isFinite(sh) && sh > 0 ? sh : undefined,
    platform: d.platform,
  };
}

/**
 * What a click on a device-list row does. Nothing on the grid changes while a
 * recording starts, runs or stops (`gridCanChange`): removing a recorded
 * device stopped its stream under the recording (the server now refuses it),
 * and the click said nothing. Through 2.36 this read a flag that was false
 * while starting, so a click then still left the phone.
 */
export function pickerToggle(
  inMosaic: boolean,
  state: Pick<MosaicState, 'recordingPhase'>,
): 'add' | 'remove' | 'blocked' {
  if (!gridCanChange(state)) return 'blocked';
  return inMosaic ? 'remove' : 'add';
}

/**
 * Whether a stream start's answer takes back the tile added before it: the
 * phone is someone else's, or two servers have a phone with this udid and the
 * server couldn't tell which one the page meant. The api-client has shown
 * the reason. Anything else keeps the tile: a network blip or a retryable 503
 * recovers by itself, since GET /stream starts the service.
 */
export function startRefusesTile(started: unknown): boolean {
  return isDeviceConflictBody(started) || isAmbiguousPhoneBody(started);
}
