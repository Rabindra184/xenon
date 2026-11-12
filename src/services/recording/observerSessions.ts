/**
 * Observer-mode recording (ENH-06): the Appium sessions a caller names, turned
 * into the phones they run on, once the caller may record every one of them.
 *
 * A session's phone is the row its claim names (`holdsClaim`: `claimSessionId`,
 * or a pre-claim row's `session_id`), on this server: a local session's phone,
 * or on a hub the node phone the hub claimed. That needs no Session row.
 *
 * All or nothing, and the answer never says which id failed: an unknown
 * session, another user's and an ownerless one (fail closed, as the device
 * guard does) all get the same bare 404 for the whole request. Every id is
 * looked up before any answer is chosen. Teams are the route's to check.
 */
import { Container } from 'typedi';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { holdsClaim } from '../../data-service/deviceClaims';
import { IDevice } from '../../interfaces/IDevice';
import { SessionOwnerResolver } from '../device-access/SessionOwnerResolver';

export interface ObservedPhone {
  sessionId: string;
  udid: string;
  host: string;
}

export interface ObserverDeps {
  /** The rows whose claim names the session (claimSessionId, or a pre-claim session_id). */
  findClaimedDevices(sessionId: string): Promise<IDevice[]>;
  ownerOf(sessionId: string): Promise<string | null>;
}

export type ObserverResolution =
  | { ok: true; phones: ObservedPhone[] }
  | { ok: false; status: 400; error: string }
  | { ok: false; status: 404 }
  | { ok: false; status: 409; busyDevices: Array<{ udid: string; reason: 'cloud_phone' }> };

/**
 * The request's `sessionIds`: a non-empty array of distinct non-empty strings.
 * Shape only; whether each names a session is resolveObservedPhones' question.
 */
export function parseSessionIds(body: unknown): string[] | { error: string } {
  if (!Array.isArray(body) || body.length === 0) {
    return { error: 'sessionIds must be a non-empty array of session ids' };
  }
  if (!body.every((id) => typeof id === 'string' && id.length > 0)) {
    return { error: 'each entry of sessionIds must be a non-empty string' };
  }
  if (new Set(body).size !== body.length) {
    return { error: 'sessionIds names a session more than once' };
  }
  return body as string[];
}

const phoneKey = (device: Pick<IDevice, 'udid' | 'host'>) => `${device.udid}@${device.host}`;

export async function resolveObservedPhones(
  sessionIds: string[],
  caller: { userId: string | null; isAdmin: boolean },
  deps: ObserverDeps,
): Promise<ObserverResolution> {
  // Every id is looked up, whichever fails, so the work done doesn't depend
  // on which one it is.
  const looked = await Promise.all(
    sessionIds.map(async (sessionId) => {
      const [devices, owner] = await Promise.all([
        deps.findClaimedDevices(sessionId),
        caller.isAdmin ? Promise.resolve(null) : deps.ownerOf(sessionId),
      ]);
      // The deps filter by the claim already; asked again so a row another
      // session has claimed since is never this one's phone.
      const claimed = devices.filter((device) => holdsClaim(device, { sessionId }));
      return { sessionId, device: claimed[0] as IDevice | undefined, owner };
    }),
  );

  const visible = looked.every(
    ({ device, owner }) =>
      device !== undefined && (caller.isAdmin || (owner != null && owner === caller.userId)),
  );
  if (!visible) return { ok: false, status: 404 };

  const seen = new Set<string>();
  for (const { device } of looked) {
    const key = phoneKey(device!);
    if (seen.has(key)) {
      return { ok: false, status: 400, error: 'two sessions in sessionIds run on one phone' };
    }
    seen.add(key);
  }

  // Recordings never read a cloud provider's phone.
  const cloud = looked.filter(({ device }) => device!.cloud);
  if (cloud.length > 0) {
    return {
      ok: false,
      status: 409,
      busyDevices: cloud.map(({ device }) => ({
        udid: device!.udid,
        reason: 'cloud_phone' as const,
      })),
    };
  }

  return {
    ok: true,
    phones: looked.map(({ sessionId, device }) => ({
      sessionId,
      udid: device!.udid,
      host: device!.host,
    })),
  };
}

/**
 * The server's own lookups: the store's rows by `claimSessionId` and by
 * `session_id` (as releaseSessionDevices finds a session's phone), merged by
 * udid@host and kept only where the claim holds; the owner from
 * SessionOwnerResolver, which reads the live owners first.
 */
export function defaultObserverDeps(): ObserverDeps {
  return {
    findClaimedDevices: async (sessionId) => {
      const store = DeviceStoreFactory.getStore();
      const rows = new Map<string, IDevice>();
      for (const device of [
        ...(await store.findDevices({ claimSessionId: sessionId })),
        ...(await store.findDevices({ session_id: sessionId })),
      ]) {
        if (holdsClaim(device, { sessionId }) && !rows.has(phoneKey(device))) {
          rows.set(phoneKey(device), device);
        }
      }
      return [...rows.values()];
    },
    ownerOf: (sessionId) => Container.get(SessionOwnerResolver).ownerOf(sessionId),
  };
}
