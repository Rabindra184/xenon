# Teams as a device boundary — design

Date: 2026-09-27
Status: approved ("Yes, all paths").

## Why

Teams were designed as a visibility boundary. The Phase 4A spec (`2026-04-30-phase-4a-team-visibility-design.md`) says mutations on an invisible device "get a natural 404 from the same filter". But only listings and one Appium path consult teams.

A member can do all of the following to another team's phone, as long as nobody else holds it:

- **Device control** (`/control/:udid/...`):
  - tap, swipe, type, install and uninstall, run a shell command;
  - read the screenshot, clipboard and logcat;
  - start a preview, and mint a stream ticket.

  The guard checks locks and Appium-session ownership only.
- **Reservations** (`/reservations`): reserve, extend or release any udid, and see every reservation.
- **SDK leases** (`POST /sdk/leases` and the MCP acquire tool): lease any device.
  - The lease's `xenon:options.leaseId` then bypasses the one team check Appium session allocation has.

## Rule

One rule, the one listings already use. A device is visible to a caller when either:

- `req.auth.teamIds === undefined`, meaning an admin or an auth-disabled server; or
- the device's `teamId` is null (the shared pool), or is one of `req.auth.teamIds`.

A member in no team (`teamIds === []`) sees only the shared pool.

A device the caller can't see answers exactly like a device that doesn't exist: **404**, with the same body the handler gives an unknown udid. The route's other refusals (401, 400, 409, 503) are unchanged. Nothing reveals that another team's phone exists.

`req.auth.teamIds` is the only input. `resolveActor(req).isAdmin`, which counts an `admin` scope, is not used here. Listings and this guard must agree.

## Where

### `/control`

A new `deviceTeamGuard()` is mounted on the control router after `roleGuard` and `mutationScopeGuard`, and **before** `deviceAccessGuard`.

- **Every request, every method, every action.** Reads (screenshot, display, apps, clipboard, logs, stream, stream/status, appium-session, omni-scan, inspector/snapshot), mutations, and `stream/start`, `stream/stop`, `stream/leave` and `stream/ticket` all go through it. Unlike the ownership guard, it has no exception list.
- **The device lookup** is the same one `deviceAccessGuard` uses: `DeviceStoreFactory.getStore().findDevice({ udid })`, injectable for tests.
  - An **unknown** device falls through to the handler's own 404.
  - A lookup that **throws** gets 503 `device_ownership_unavailable`. That fails closed, as the ownership guard does.
- **A malformed udid segment** gets 400 `invalid_udid`, as in the ownership guard.
- **The stream-ticket path.** `GET /control/:udid/stream?ticket=` is authenticated by the ticket, which sets `teamIds: undefined`. That's acceptable: a ticket is minted only by `POST stream/ticket`, which this guard now covers, and tickets are single-use and short-lived.
- **WebSockets.** The H.264 and logcat WebSockets redeem the same tickets, so they inherit the check. No separate WebSocket change is needed.

### Reservations (`src/app/routers/reservation.ts`)

- `POST /` (reserve), `DELETE /:udid/:host` and `POST /:udid/:host/extend` answer 404 for a device the caller can't see.
- `GET /` lists only reservations on visible devices (`filterRowsByVisibleDevice`).

### SDK leases (`src/app/routers/sdk-leases.ts`, `LeaseService.create`)

- The device match gets `callerTeamIds = req.auth.teamIds`, the filter `findAndLockDevice` already supports and Appium allocation already uses. A non-admin can then lease only a visible device.
- If nothing visible matches, the route gives its existing "no device available" answer.
- This also closes the lease-bound-session bypass, because a lease can only have been made on a visible device.

### Unchanged

- **Appium sessions that present no credentials stay unscoped.** This is the existing compatibility choice, and `XENON_REQUIRE_SESSION_TOKEN` enforces credentials.
- **Admins** are unchanged.
- **Auth-disabled servers** are unchanged: everyone is an admin.
- **Recording write routes** are fixed separately (`fix/recording-write-visibility`).

## Operational note (release notes: "Changed — operator action may be needed")

After this ships, members can use only phones in the shared pool or on their teams. Anyone who today uses a team's phone without being a member of that team loses access until an admin adds them (Teams page). Admins are unaffected.

## Testing

- **Unit (`deviceTeamGuard`)** covers these cases:
  - Two teams, plus a shared phone, a no-team member and an admin.
  - Every method: a GET read (screenshot), a mutation (tap), and each of `stream/start`, `stream/ticket`, `stream/stop` and `stream/leave`:
    - an other-team device → 404;
    - own team or shared → next;
    - admin → next.
  - An unknown device → next.
  - A lookup that throws → 503.
  - A malformed udid → 400.
- **Integration** (following the `test/integration/team-visibility-*.spec.ts` pattern, with the real auth middleware and teams):
  - A team-A member gets 404 on team-B's screenshot, tap and stream/ticket, and 200 on team-A's and on a shared phone.
- **Reservations:** reserve, extend and release on an other-team phone → 404. The list hides other teams' reservations.
- **SDK leases:** a team-A member's lease never lands on a team-B device, even when the filter names its udid. An admin's can.
- **Suites:** the existing guard, policy, stream-start and logcat suites still pass. `npm run test:all` passes in full.
- **Docs:** CLAUDE.md's "Device access guard" section gains the team guard.
