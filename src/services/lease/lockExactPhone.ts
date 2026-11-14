import type { IDevice } from '../../interfaces/IDevice';

/**
 * Locks one phone for a lease, by its exact udid and host, or answers null.
 *
 * `filterByHost` alone is a substring match in the Prisma store (`host: {
 * contains }`), so a twin udid on `http://a:47230` matched `http://a:4723`.
 * `only` (LockOptions, as allocation passes it) keeps the lock to that exact
 * row, so no other row is ever locked and nothing needs giving back. Through
 * 2.36 the wrong twin was locked and then set `busy: false` unconditionally.
 */
export async function lockExactPhone(
  store: { findAndLockDevice(filter: any, options?: any): Promise<IDevice | null> },
  udid: string,
  host: string,
): Promise<IDevice | null> {
  const locked = await store.findAndLockDevice(
    { udid: [udid], filterByHost: host },
    { only: new Set([`${udid}@${host}`]) },
  );
  if (!locked || locked.udid !== udid || locked.host !== host) return null;
  return locked;
}
