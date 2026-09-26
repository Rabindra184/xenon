import { Prisma } from '../generated/client';

/** Every scalar column of the Device model, from the generated client. */
const DEVICE_COLUMNS = new Set<string>(Object.keys(Prisma.DeviceScalarFieldEnum));

/**
 * Keep only the keys the Device table has.
 *
 * A node registers its devices with the hub, which upserts them as sent. A
 * key the hub's schema lacks (a newer node's new column, or a derived field
 * like `teamName`) made Prisma reject the whole write. Dropping it keeps the
 * device, minus what this hub can't store.
 */
export function pickDeviceColumns(
  data: Record<string, unknown>,
  onDrop?: (key: string) => void,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (DEVICE_COLUMNS.has(key)) out[key] = value;
    else onDrop?.(key);
  }
  return out;
}
