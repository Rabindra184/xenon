/** What a device says about itself, for the dashboard. All null when unknown. */
export interface DeviceIdentity {
  marketingName: string | null;
  model: string | null;
  manufacturer: string | null;
  formFactor: 'phone' | 'tablet' | 'tv' | null;
}

export const EMPTY_IDENTITY: DeviceIdentity = {
  marketingName: null,
  model: null,
  manufacturer: null,
  formFactor: null,
};

/** The known parts only, so a failed lookup never overwrites a stored value. */
export function nonNullIdentity(i: DeviceIdentity): Partial<DeviceIdentity> {
  return Object.fromEntries(
    Object.entries(i).filter(([, v]) => v !== null),
  ) as Partial<DeviceIdentity>;
}
