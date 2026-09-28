# Team-owned apps — design

Date: 2026-09-28
Status: approved.

## Why

Two problems with uploaded apps (APK/IPA, the `App` model, `src/app/routers/apps.ts`):

- **Apps have no team.** Any member can list and download every team's binaries, although 1.29.0 made teams a device boundary and 1.29.1 extended it to session data.
- **A session that names an app by id can't download it when auth is on.** `SessionLifecycleService` rewrites `appium:app: <id>` to `http://<host>:<port>/xenon/api/apps/<id>/download`, and the Appium driver downloads that URL itself. The route is behind `authMiddleware`, and the driver sends no credentials, so the download is refused and the session fails.

## Rule

Apps follow the device team rule, `isDeviceVisible(app.teamId, req.auth.teamIds)`, wrapped as `canSeeApp` in `src/services/device-access/appVisibility.ts`:

- `teamIds === undefined` (an admin, or an auth-disabled server) sees every app.
- An app with no team is shared, and everyone sees it, including a member in no team.
- Otherwise the app's team must be one of the caller's.

An app the caller can't see answers every route exactly as an unknown id does: the same status and the same body.

## Schema

- `App.teamId String?`, related to `Team` with `onDelete: SetNull`, and `@@index([teamId])`. `Team.apps App[]`.
- Migration `20260928120000_app_team`. Prisma writes a SQLite foreign key as a table rebuild (`new_App`, copy, drop, rename), so the migration is that rather than one `ALTER TABLE`. Every existing row is copied with `teamId` NULL: existing apps stay shared.
- `runMigrations` applies it at startup, as usual: `db push` on SQLite, `migrate deploy` on PostgreSQL.

## Routes (`src/app/routers/apps.ts`)

| Route | Who | Behaviour |
|---|---|---|
| `GET /apps` | member+ | Filtered in the query by `visibleAppWhere(teamIds)`: `{ OR: [{ teamId: null }, { teamId: { in: teamIds } }] }`, no filter for an admin. Each row includes `team: { id, name }` so the Team column works for members, who cannot read the admin-only `/teams`. |
| `GET /apps/:id/download` | member+, or a download ticket | Hidden and unknown alike: `404 { error: 'App not found' }`. Still sent with `DOWNLOAD_OPTIONS` (Express 5 dotfiles), on the ticket path too, since it is the same `res.download` call. |
| `POST /apps/upload` | admin | Optional multipart `teamId`. Omitted, empty or null means shared. An unknown team is `400 { error: 'team not found' }`, checked before anything is stored. A non-string is `400`. |
| `PUT /apps/:id/team` | admin (`roleGuard('ADMIN')` + `scopeGuard(['admin'])`) | Body `{ teamId: string \| null }`. Shaped like `PUT /grid/device/:udid/team`: `404 { error: 'team not found' }` for an unknown team, `404 { error: 'App not found' }` for an unknown app, `{ ok: true, updated: 1 }` on success, `400` for a non-string. |
| `DELETE /apps/:id` | admin | Hidden and unknown alike: `404 { error: 'App not found' }`, and nothing is deleted. **Changed:** an unknown id used to answer `204`. |

### Upload dedupe

`App.md5` is `@unique`. An upload whose bytes are already stored returns the existing app, and did before this change. It stays that way: the existing app keeps its team, whatever `teamId` the new upload named, and the response shows that team. An admin who wants it elsewhere moves it with `PUT /apps/:id/team`. A second copy per team was not an option without dropping the unique md5.

### Installing from the registry

`POST /control/:udid/install-repository-app` installs an uploaded app onto a phone from the hub's disk. A member who could install another team's app onto a shared phone could then pull the binary back off it, so the route applies `canSeeApp` too: another team's app gets the unknown answer, `404 App not found in repository`, and nothing is installed. The phone itself is still covered by the `/control` team guard.

### Deleting a team

`TeamService.delete` already refuses a team that still has phones or members. It now also refuses one that still owns apps. `onDelete: SetNull` would otherwise quietly turn a deleted team's apps into shared apps, open to every member. The admin moves or deletes them first. The foreign key's `SetNull` stays as the database-level fallback.

## Sessions that name an app by id

In `SessionLifecycleService.createSession`:

1. **Same teams as the phone.** `sessionTeamIds` is computed once and used for both device allocation and app resolution: a lease-bound session's `leaseAccess.teamIds`, otherwise `callerTeamIds` when the credential is scoped, otherwise undefined. A team-bound key sees its team's apps, a member key with no team sees shared apps, an admin key sees all.
2. **Hidden is unknown.** Today an unknown id is left in the capability untouched, and the driver then fails the session looking for a file by that name. An app the session can't see is treated exactly the same way: the capability goes to the driver as the client sent it, and no ticket is minted. The unit test asserts the capabilities the driver receives are identical in both cases.
3. **A visible app** is rewritten to the plain download URL before the pending-session row is written.
4. **The ticket is added only for the driver.** Right before `next()` (a local session) or `forwardSessionRequest` (a session on a peer node), a ticket is minted and appended as `?ticket=`. The local caps get the plain URL back in a `finally` once `next()` returns, so the pending-session row, the stored Session row and Xenon's own logs keep the plain URL. The forwarded copy is a deep copy, so the hub's caps never carry it. This matters because members who can see a shared phone can read its pending sessions and session capabilities, and the app may be another team's. Appium's `[HTTP]` request log and the driver's "Using downloadable app" line do print the full URL, as they print stream tickets. By then the ticket is spent, or it expires within 10 minutes. The server log is operator-only.
5. **Auth disabled:** no ticket. The route needs no login, and a stable URL lets the driver reuse its cached download (Appium's app cache is keyed by URL).
6. **Mint failure** (for example, `JwtKeyService` failed to initialise at boot) fails the session with `Cannot prepare the download of app <id>: …`, inside the existing error path, so the allocated phone is released.

## Download tickets

`AppDownloadTicketService` (`src/services/token/AppDownloadTicketService.ts`), modelled on `StreamTicketService`:

- RS256 through `JwtKeyService`, **audience `xenon-app-download`**. The stream route verifies `xenon-stream`, so neither ticket works on the other's route.
- Claims: `appId` only. The ticket carries no identity: the team check happened when it was minted.
- TTL **10 minutes** (`APP_TICKET_TTL_SEC = 600`): long enough to wait for a phone and start the driver, short enough to be worthless soon after.
- **Single-use**, by `jti`. The replay ledger is now `SingleUseLedger` (`src/services/token/singleUseLedger.ts`), shared with `StreamTicketService`, so both evict a `jti` only after `exp` plus `verify()`'s 60 s clock tolerance. The existing replay-window regression test covers the refactor.
- A ticket presented for the wrong app is not spent.

`authMiddleware` accepts it as **Path 4**, next to the stream ticket's Path 3: only `GET /apps/:id/download` with `?ticket=`. On success `req.auth` is `{ kind: 'app-ticket', role: 'MEMBER', scopes: 'read', teamIds: undefined, appId }`, and `req.apiKey` is unset. The download handler also checks `req.auth.appId === app.id`, so the binding does not rest on the path regex alone.

**Every ticket failure is `401 { error: 'invalid ticket' }`**: expired, used, forged, a stream ticket, or a ticket for another app. 401 rather than 404 because:

- the request presented no other credentials, so this is an authentication failure, and it matches the stream route;
- the answer is the same whichever app the URL names, so it can't be used to learn whether some other app exists. The "hidden looks unknown" rule is about what a signed-in caller sees, and a ticket never reaches a hidden app: it is minted only for an app the session can see;
- a 404 would tell a driver the app is gone when the real problem is a spent or late ticket.

A ticket does not open anything else: `GET /apps?ticket=`, any other method, and the stream route all answer 401 as without it.

## Dashboard (`web/src/components/apps/`)

- **Team column**, between Size and Registry date: the team's name from the list response, or "Shared". A long name ellipsizes. The grid is `3fr 1fr 1fr 1fr 1.5fr 2fr`; at 1280 px the team track is 119 px and the actions track 237 px, which holds the admin's four actions (204 px).
- **Upload dialog** (admins): "Upload app" opens a `ui/Modal` with a Team picker (Shared by default, or any team from `/teams`), then "Choose file…". Members keep the old direct file picker; the server refuses them either way.
- **Move to team** (admins): an icon button per row opens a `ui/Modal` with the same picker, preset to the app's team. An error stays in the dialog, because a modal hides the page's toasts.
- `TeamSelect` in `AppTeamDialogs.tsx` renders the options the Devices page's `TeamPicker` does. It is a separate component because `TeamPicker` saves on change and is bound to devices.
- The Teams page's delete confirmation now says a team must have no apps either.
- Role tokens only (`--text`, `--text-muted`, `--space-3`), and no colour literals.

## Unchanged

- `getWDAApp()` (iOS WebDriverAgent provisioning) still picks the newest WDA build regardless of team. It is lab infrastructure, installed by the server, not an app a client downloads.

## Tests

- Unit: `AppDownloadTicketService.spec.ts`, `authMiddleware.appTicket.spec.ts` (real mount order, bytes, 206 Range, reuse, wrong app, expiry, stream ticket refused, app ticket refused on the stream route), `apps-team-visibility.spec.ts` (list, download, delete, upload `teamId`, `PUT /:id/team`, dedupe), `session-app-resolution.spec.ts` (visible, hidden versus unknown, admin, team-bound and team-less keys, `firstMatch`, auth disabled, ticket only in the driver's caps, forwarded copy, mint failure releases the phone), `install-repository-app-team.spec.ts`, `TeamService.test.ts`.
- Integration on a real SQLite database: `test/integration/team-visibility-apps.spec.ts`. This covers the list's Prisma filter, including an empty `in` for a member in no team.
- Web (Vitest): the Team column, the upload picker sending `teamId`, and the Move dialog.
- The end-to-end driver download needs a live device.
