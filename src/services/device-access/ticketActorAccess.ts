import { isManualLock } from '../recording/manualLock';
import { evaluateDeviceAccess } from './deviceAccessPolicy';
import type { StreamTicketActor } from '../token/StreamTicketService';

/** The two device-row fields an ownership decision reads. */
export interface DeviceOwnershipRow {
  busy?: boolean;
  session_id?: string | null;
}

export interface DeviceOwnershipLookups {
  /** Resolve the device row, or null/undefined when the store doesn't know it. */
  findDevice: (udid: string) => Promise<DeviceOwnershipRow | null | undefined>;
  /** Resolve the owning user of an Appium session id. */
  resolveSessionOwner: (sessionId: string) => Promise<string | null>;
}

/**
 * Build the ownership check for a caller authenticated by a stream ticket.
 *
 * This is the same `findDevice → isManualLock → ownerOf → evaluateDeviceAccess`
 * preamble `deviceAccessGuard` and `stream/start` run, factored out so the WS
 * wiring in ServerManager is one call rather than a hand-copied block. The copy
 * it replaces had already drifted: it hardcoded `isAdmin: false` and dropped
 * `actorApiKeyId`, so an admin could not watch another user's device and a
 * caller holding a pre-1.13.0 `manual_<apiKeyId>_<udid>` lock was refused their
 * own — while `/control` admitted both.
 *
 * I/O-free once the two lookups are injected, so the whole truth table is
 * unit-testable without a device or a database.
 *
 * Fails closed twice over:
 *  - a lookup that throws propagates (the caller must turn that into a refusal;
 *    never resolve `false`-as-unknown or, worse, `true`);
 *  - an **unknown device denies**. This deliberately differs from
 *    `deviceAccessGuard`, whose unknown-device branch falls through to a
 *    handler that 404s. There is no 404 behind this one: the WS handler goes
 *    straight to `startStream`, and `AndroidDeviceManager.getAdbForDevice` does
 *    not throw for an unrecognised udid — it hands back the local adb, so
 *    `adb -s <udid> logcat` runs against whatever that serial resolves to. Any
 *    authenticated member could otherwise stream logs from a device Xenon's
 *    store cannot resolve (one just reaped by `removeStaleDevices`, or attached
 *    before the next discovery poll) with no ownership check at all, since
 *    `stream/ticket` mints for any udid string and sits in
 *    `UNGUARDED_CONTROL_MUTATIONS`. Admins are denied too: with no device row
 *    there is nothing to bypass, and the dashboard only ever offers devices the
 *    store knows.
 */
export function makeTicketActorAuthorizer(deps: DeviceOwnershipLookups) {
  return async function authorizeTicketActor(
    udid: string,
    actor: StreamTicketActor,
  ): Promise<boolean> {
    const device = await deps.findDevice(udid);
    if (!device) return false;

    const sessionOwnerUserId =
      device.busy && device.session_id && !isManualLock(device.session_id)
        ? await deps.resolveSessionOwner(device.session_id)
        : null;

    return evaluateDeviceAccess({
      udid,
      busy: !!device.busy,
      sessionId: device.session_id,
      sessionOwnerUserId,
      // The ticket's actorId is a User id — see StreamTicketService.
      actorUserId: actor.actorId,
      actorApiKeyId: actor.apiKeyId,
      isAdmin: !!actor.isAdmin,
    }).allow;
  };
}
