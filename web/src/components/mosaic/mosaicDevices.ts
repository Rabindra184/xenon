import type { MosaicTile } from './recording-group-store';

/** A device as the Live Devices page reads it from GET /xenon/api/device. */
export interface DeviceRow {
  udid: string;
  name?: string;
  /** What people call it ("Galaxy S9+"), read from the device by the server. */
  marketingName?: string | null;
  platform?: string;
  busy?: boolean;
  session_id?: string;
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
    name: deviceLabel(d),
    mjpegPort: 0,
    aspect: tileAspect(d),
    screenWidth: Number.isFinite(sw) && sw > 0 ? sw : undefined,
    screenHeight: Number.isFinite(sh) && sh > 0 ? sh : undefined,
    platform: d.platform,
  };
}

/**
 * What a click on a device-list row does. Nothing on the grid changes while
 * recording: removing a recorded device stopped its stream under the
 * recording (the server now refuses it), and the click said nothing.
 */
export function pickerToggle(inMosaic: boolean, recording: boolean): 'add' | 'remove' | 'blocked' {
  if (recording) return 'blocked';
  return inMosaic ? 'remove' : 'add';
}
