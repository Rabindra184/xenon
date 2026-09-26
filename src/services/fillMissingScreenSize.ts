import type { IDevice } from '../interfaces/IDevice';

interface Deps {
  managerFor: (
    platform: string,
  ) => Promise<
    { getAdditionalDeviceInfo?(device: IDevice): Promise<Partial<IDevice>> } | undefined
  >;
  updateDevice: (udid: string, host: string, patch: Partial<IDevice>) => Promise<unknown>;
}

/** One lookup per device at a time: a reload attaches the ticket and stream together. */
const inFlight = new Map<string, Promise<boolean>>();

/**
 * Fetch and store a device's screen size when it isn't known yet.
 *
 * The dashboard only enables taps on a tile once the size is known, because it
 * converts tile positions into device pixels. stream/start used to be the only
 * place that fetched it, but a reload restores tiles through stream/status,
 * stream/ticket and the H.264 socket without ever calling stream/start. After
 * a server restart the size was never fetched, and restored tiles could not be
 * tapped at all. Every stream attach point calls this now.
 *
 * Never throws; resolves true when a size was stored.
 */
export function fillMissingScreenSize(device: IDevice, deps: Deps): Promise<boolean> {
  if (device.screenWidth && device.screenHeight) return Promise.resolve(false);
  const existing = inFlight.get(device.udid);
  if (existing) return existing;
  const task = (async () => {
    try {
      const manager = await deps.managerFor(device.platform);
      if (!manager?.getAdditionalDeviceInfo) return false;
      const info = await manager.getAdditionalDeviceInfo(device);
      if (!info?.screenWidth || !info?.screenHeight) return false;
      await deps.updateDevice(device.udid, device.host, info);
      return true;
    } catch {
      return false;
    }
  })().finally(() => inFlight.delete(device.udid));
  inFlight.set(device.udid, task);
  return task;
}
