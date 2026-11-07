/**
 * What a lease request's filters (one member's) mean as a device-store
 * filter, and which matching phones a lease may take now. LeaseService's
 * create and the lease queue's grant passes read phones the same way.
 */

/** One member's filters, as a lease request sends them. */
export interface LeaseFilters {
  platform: 'android' | 'ios';
  sdk?: string;
  deviceName?: string;
  udid?: string;
  deviceType?: string;
  tags?: string[];
}

/**
 * The caller's teams as a device-store filter. Unscoped (admin, auth disabled)
 * is no key at all: the stores treat a present `callerTeamIds` as a list.
 */
export function teamScope(callerTeamIds: string[] | undefined): { callerTeamIds?: string[] } {
  return callerTeamIds === undefined ? {} : { callerTeamIds };
}

/**
 * The client's filters as a device-store filter, without a team list, which
 * only the credential may set. `sdk` is the OS version (`platformVersion`,
 * which wins when both are sent). `deviceName` isn't a store filter: see
 * nameMatches.
 */
export function clientFilters(filters: LeaseFilters): Record<string, unknown> {
  const out: Record<string, unknown> = { ...filters };
  delete out.callerTeamIds;
  delete out.deviceName;
  delete out.sdk;
  // The availability fields are the lease's to decide, never the client's.
  delete out.busy;
  delete out.userBlocked;
  delete out.offline;
  if (typeof filters.sdk === 'string' && filters.sdk !== '' && out.platformVersion === undefined) {
    out.platformVersion = filters.sdk;
  }
  return out;
}

/** `filters.deviceName`: the device's name, ignoring case. */
export function nameMatches(deviceName: unknown): (device: any) => boolean {
  if (typeof deviceName !== 'string' || deviceName === '') return () => true;
  const wanted = deviceName.toLowerCase();
  return (device) => typeof device.name === 'string' && device.name.toLowerCase() === wanted;
}

/**
 * Whether a lease may take a matching device now. Session allocation skips
 * the same devices: blocked by an admin, reserved, or failing its health
 * check. Busy and already-leased devices are skipped by the lock itself.
 */
export function leasable(device: any, now: number): boolean {
  if (device.busy || device.userBlocked || device.offline) return false;
  if (device.reservedUntil && now < device.reservedUntil) return false;
  return device.healthStatus !== 'Unhealthy';
}
