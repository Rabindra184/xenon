# Live dashboard events respect teams — design

Date: 2026-09-27
Status: approved ("All device events").

## Why

Every dashboard event goes through one call, `SocketServer.emitToDashboard(event, data)`, which sends it to one flat Socket.io room, `'dashboard'`. Every connected dashboard socket receives it, whatever its user's team. Those events include:

- **Device events** (`device_added`, `device_removed`, `device_progress`, `device_blocked`, `device_unblocked`), which carry the whole device row;
- **Session events** (started, stopped, commands, healing);
- **Interceptor events**;
- **Recording events**;
- **A bug report**, which is sent with `broadcast`, reaching every socket (nodes included).

So a member's dashboard, or the IDE extension, sees other teams' phones, sessions, commands and network traffic.

The sockets can't be scoped today, because `SocketServer.authenticate()` looks up the user and then keeps only a principal string (`'dashboard' | 'node' | 'auth-disabled'`).

## Rule

It is the same rule as REST and device control:

- A socket whose `teamIds` is `undefined` (an admin, or an auth-disabled server) sees everything.
- Any other socket sees a device when the device's `teamId` is null (shared) or is in its `teamIds`.
- `teamIds` is computed exactly as `authMiddleware.computeTeamIds` does:
  - ADMIN or SUPER_ADMIN gives `undefined`.
  - A team-narrowed key or bearer gives `[teamId]`.
  - Otherwise it's the user's `TeamMember` teams.

## Design

1. **The socket keeps who it is.** `authenticate()` returns `{ principal, userId, role, teamIds }`, stored on `socket.data`.
   - It uses the one shared `computeTeamIds` (`src/services/device-access/callerTeamIds.ts`), so REST and sockets agree.
   - An auth-disabled socket gets `teamIds: undefined`.
   - Identity is fixed at connect. A membership change applies when the dashboard reconnects, which happens on reload. That's documented.
2. **A scoped emit.** `SocketServer.emitToDashboardForDevices(event, data, scope)`, where `scope` is one of:
   - `{ udid }`, for one device: send to each dashboard socket that can see it;
   - `{ udids, strip(data, visibleUdids) }`, for a payload carrying several phones (recording started/stopped): each socket gets the payload stripped to its visible phones, and nothing if none are visible.

   Sockets come from the local `'dashboard'` room. The event log (`EventLogService.appendSafe`) still records each event once, unscoped.
3. **Device to team, without a query per command.** A small `DeviceTeamResolver`:
   - It maps a udid to its `teamId` from the device store, with a short TTL cache (a few seconds).
   - Device events refresh it, and so does a team change on a device, which goes through `assignDeviceToTeam`.
   - An unknown udid resolves to "hidden from non-admins": fail closed.
4. **Which events become scoped:**
   - **Device events:** the row's own `teamId`; no lookup.
   - **Session started/stopped (both sites), commands and healing:** the session's device udid, through the resolver.
   - **Interceptor events:** the session's device, through the resolver.
   - **Recording started/stopped:** stripped per socket. Bookmark, annotation and failed are single-phone events, scoped by their recording's device.
   - **The bug report:** it moves from `broadcast` (every socket, nodes included) to the scoped dashboard emit for the session's device.
5. **Unchanged:**
   - Selector events (`SELECTOR_*`), which are cross-device aggregates rather than a phone's data;
   - `NODE_*` and the `'nodes'` room;
   - the event log;
   - the REST routes.

## Consumers

- **The dashboard.** It listens to device, session, selector, interceptor and other events through `useSocket`, which is used by the device explorer, builds, overview, selector health, network panel, settings, the regression banner and connection status.
  - A member's pages then only receive events for phones they can already see over REST, so they stay consistent with their lists.
  - The recording pages don't listen to recording events.
- **The IDE extension** connects with a bearer token. It gets its user's scope, which is the intended behaviour.

## Testing

- **Unit:** `authenticate()` returns the identity, and `teamIds` for admin, member, team-narrowed key, and auth-disabled. These extend `socketServer.bearer.spec.ts` and add cookie and key-pair cases.
- **Unit:** the scoped emit, with fake sockets:
  - `{ udid }` delivers only to sockets that see the device;
  - `strip` gives each socket its own payload;
  - nothing is sent when none are visible;
  - admins get everything.
- **Unit:** the resolver's TTL, its refresh on device events, and its unknown-udid behaviour.
- **Integration:** a real Socket.io server with two clients, a team-A member and an admin.
  - A team-B `device_added`, and a session command on a team-B phone, reach only the admin.
  - A team-A one reaches both.
- **Suites:** existing tests stay green, and `npm run test:all` passes in full.
- **Live, on the lab:** auth is disabled there, so everyone is an admin and the dashboard must behave exactly as before. Load the Devices and Live devices pages and confirm events still arrive.
