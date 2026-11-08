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
  /** Phones carrying every one of these tags. */
  tags?: string[];
  /** No phone carrying any of these tags (ENH-10). Applied by memberMatches. */
  excludeTags?: string[];
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
  // memberMatches applies it; the stores don't know it.
  delete out.excludeTags;
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

/** A phone's tags, from the store's list or a row's JSON text. */
function tagsOf(device: any): string[] {
  const tags = device?.tags;
  if (Array.isArray(tags)) return tags.map(String);
  if (typeof tags === 'string' && tags !== '') {
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * `filters.excludeTags`: no phone carrying any of them. A lab can then keep
 * CI's phones out of exploratory leases (and the reverse) without giving
 * every phone exactly one pool tag (Xenon Test's ENH-10).
 */
export function tagsAllowed(excludeTags: unknown): (device: any) => boolean {
  if (!Array.isArray(excludeTags) || excludeTags.length === 0) return () => true;
  const excluded = new Set(excludeTags.map(String));
  return (device) => !tagsOf(device).some((tag) => excluded.has(tag));
}

/**
 * What a member's filters ask beyond the store's filter: the device's name
 * and the tags it must not carry. Every place that picks a lease's phones
 * (LeaseService's create, the queue's candidates) applies it.
 */
export function memberMatches(filters: LeaseFilters): (device: any) => boolean {
  const name = nameMatches(filters.deviceName);
  const tags = tagsAllowed(filters.excludeTags);
  return (device) => name(device) && tags(device);
}

/**
 * Why a member's `excludeTags` can't be read, or null when it can: absent,
 * or a list of non-empty strings.
 */
export function excludeTagsProblem(filters: unknown): string | null {
  const value = (filters as any)?.excludeTags;
  if (value === undefined) return null;
  const ok =
    Array.isArray(value) && value.every((tag) => typeof tag === 'string' && tag.trim() !== '');
  return ok ? null : 'excludeTags must be a list of tags';
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
