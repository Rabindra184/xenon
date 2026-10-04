/**
 * In-memory tables to stub `prisma.device` (fakeDeviceTable) and
 * `prisma.deviceSetting` (fakeDeviceSettingTable) with, so a spec runs the
 * real PrismaDeviceStore. They follow Prisma's rules: `undefined` leaves a
 * column alone, `null` clears it, an upsert takes `create` for a new row and
 * `update` for a known one, and `{ contains }` matches a substring (the store
 * uses it for a host that isn't a URL).
 */

export type Row = Record<string, any>;

const key = (udid: string, host: string) => `${udid}|${host}`;
const matches = (row: Row, where: Row | undefined): boolean => {
  if (!where) return true;
  return Object.entries(where).every(([field, cond]) => {
    if (field === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    if (field === 'AND') return (cond as Row[]).every((w) => matches(row, w));
    if (cond && typeof cond === 'object' && 'in' in cond) return cond.in.includes(row[field]);
    if (cond && typeof cond === 'object' && 'contains' in cond)
      return String(row[field] ?? '').includes(cond.contains);
    return row[field] === cond;
  });
};
const write = (row: Row, data: Row) => {
  for (const [field, value] of Object.entries(data)) if (value !== undefined) row[field] = value;
};

/**
 * The saved settings of phones (DeviceSetting), to stub `prisma.deviceSetting`
 * with beside fakeDeviceTable, so the store's settings don't reach a database.
 */
export function fakeDeviceSettingTable(seed: Row[] = []) {
  const rows = new Map<string, Row>();
  for (const r of seed) rows.set(key(r.udid, r.host), { userBlocked: false, ...r });
  return {
    row: (udid: string, host?: string) =>
      [...rows.values()].find((r) => r.udid === udid && (host === undefined || r.host === host)),
    delegate: {
      findMany: async (args: { where?: Row } = {}) =>
        [...rows.values()].filter((r) => matches(r, args.where)).map((r) => ({ ...r })),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { udid_host: { udid: string; host: string } };
        create: Row;
        update: Row;
      }) => {
        const k = key(where.udid_host.udid, where.udid_host.host);
        const found = rows.get(k);
        if (found) {
          write(found, update);
          return { ...found };
        }
        const created: Row = { userBlocked: false };
        write(created, create);
        rows.set(k, created);
        return { ...created };
      },
      deleteMany: async (args: { where?: Row } = {}) => {
        let count = 0;
        for (const [k, r] of rows) {
          if (matches(r, args.where)) {
            rows.delete(k);
            count++;
          }
        }
        return { count };
      },
    },
  };
}

export function fakeDeviceTable(seed: Row[]) {
  const rows = new Map<string, Row>();
  const defaults = (): Row => ({
    busy: false,
    userBlocked: false,
    offline: false,
    session_id: null,
    teamId: null,
    sessionProgress: '',
    sessionStartTime: 0,
    totalUtilizationTimeMilliSec: 0,
    claimSessionId: null,
    claimedAt: null,
    nodeBusy: false,
  });
  for (const r of seed) rows.set(key(r.udid, r.host), { ...defaults(), ...r });

  return {
    row: (udid: string) => [...rows.values()].find((r) => r.udid === udid),
    delegate: {
      findMany: async (args: { where?: Row } = {}) =>
        [...rows.values()].filter((r) => matches(r, args.where)).map((r) => ({ ...r })),
      findUnique: async ({ where }: { where: { udid_host: { udid: string; host: string } } }) => {
        const r = rows.get(key(where.udid_host.udid, where.udid_host.host));
        return r ? { ...r } : null;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { udid_host: { udid: string; host: string } };
        create: Row;
        update: Row;
      }) => {
        const k = key(where.udid_host.udid, where.udid_host.host);
        const found = rows.get(k);
        if (found) {
          write(found, update);
          return { ...found };
        }
        const created = defaults();
        write(created, create);
        rows.set(k, created);
        return { ...created };
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const r of rows.values()) {
          if (matches(r, where)) {
            write(r, data);
            count++;
          }
        }
        return { count };
      },
      deleteMany: async ({ where }: { where: Row }) => {
        for (const [k, r] of rows) if (matches(r, where)) rows.delete(k);
        return { count: 0 };
      },
    },
  };
}
