/**
 * A fake device store whose `findDevice` stands for the one row of a udid,
 * given the `findDevices` /control resolves a phone with (findPhone in
 * src/middleware/controlDevice.ts): that row, or none. One row per udid, so
 * never ambiguous.
 */
export function withFindDevices<T extends { findDevice: (filter: any) => Promise<any> }>(
  store: T,
): T & { findDevices: (filter: any) => Promise<any[]> } {
  return {
    ...store,
    findDevices: async (filter: any) => {
      const row = await store.findDevice(filter);
      return row ? [row] : [];
    },
  };
}
