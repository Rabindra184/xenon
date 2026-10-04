---
title: Teams
description: Teams decide which phones, apps and sessions each person can see. How the rule works, how to set teams up in the dashboard and over the API, and what a test gets.
---

Teams split a shared lab between groups of people. Each phone belongs to one team or to the **shared pool**, and a member can use their teams' phones and the shared pool, and nothing else. This page explains who sees what, how to set teams up, and how the rule reaches tests. If everyone in your lab may use every phone, you don't need teams: leave all phones in the shared pool.

## Who sees what

| Person | Sees |
|---|---|
| **Member** | The shared pool and the phones of the teams they belong to. A member who is in no team sees only the shared pool. |
| **Admin** and **Super admin** | Every phone, whatever its team. |
| Anyone, on a server with sign-in turned off | Every phone. |

The rule is the same everywhere a phone shows up:

- **Phones.** The Devices page, device control, live preview and logs, reservations, recordings and the live updates the dashboard receives.
- **Sessions follow their phone.** A member sees a session, its build, its bug reports and its healing records when its phone is in the shared pool or in one of their teams. A session whose phone has since been unplugged is visible to its owner only.
- **Uploaded apps have a team.** An app uploaded for a team is listed, downloaded, installed and run only by that team's members and by admins. An app with no team is shared. See [Apps](#apps-have-a-team).
- **SDK leases.** A member can lease only the phones they can see: see [Leases for CI](./leases.md).
- **The session queue.** A member sees in detail the waiting requests from their own teams and for phones they can see, and the rest only as a count.

**A phone you can't see doesn't exist.** A request about a phone that belongs to another team gets the same answer as one about a UDID that Xenon has never heard of: a `404` saying `Device not found`. It never says that the phone exists, or who has it.

## Set up teams

Setting teams up takes an admin: the Admin role or above, and for the API a token with the `admin` scope.

### In the dashboard

1. **Create a team.** Open **Teams** and choose **New team**. Team names must be unique.
2. **Add people.** Open the team. Under **Members**, pick a user in the list and choose **Add**. A user you add sees the team's phones from their next request. A dashboard that is already open follows when it reconnects, which a reload does.
3. **Assign phones.** In the same team, under **Devices**, pick a phone from the shared pool and choose **Assign**. **Return to shared pool** gives it back. New phones always arrive in the shared pool: Xenon never guesses a team.

:::caution[A phone's team goes when its record goes]
A phone's team is kept in its record in the server's device list, and the record is removed when the phone is unplugged or reboots, when adb reports it offline or unauthorized, when an iPhone detaches, when the server restarts, and, on a hub, when a node unregisters or misses a single health probe. The phone comes back as a new one, in the shared pool, and stays there until an admin assigns its team again. [Devices and allocation](./devices.md#what-xenon-discovers) lists the causes.
:::

### Over the API

```bash
# Create a team
curl -X POST http://localhost:4723/xenon/api/teams \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"android-qa"}'
# {"id":"3acef541-...","name":"android-qa","createdAt":"..."}

# Add a user to it (the user's id is in GET /xenon/api/users)
curl -X POST http://localhost:4723/xenon/api/teams/3acef541-.../members \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"userId":"7c1e2d4a-..."}'

# Give a phone to the team
curl -X PUT http://localhost:4723/xenon/api/device/emulator-5554/team \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"teamId":"3acef541-..."}'

# Return it to the shared pool
curl -X PUT http://localhost:4723/xenon/api/device/emulator-5554/team \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"teamId":null}'
```

- A duplicate team name answers `409`. `DELETE /xenon/api/teams/<id>/members/<userId>` takes a user out of a team, and keeps their account and tokens.
- A phone's team is set by UDID. When a hub lists the same UDID from several nodes, which happens with emulators, every one of them moves.
- The [API reference](/api) lists every team and device route.

### Apps have a team

On the **Apps** page, an admin picks a team when uploading an app, and can move an app later with **Move to team**. Over the API, `POST /xenon/api/apps/upload` takes an optional `teamId` field, and `PUT /xenon/api/apps/<id>/team` takes `{"teamId": "..."}` or `{"teamId": null}` for the shared pool. Uploading a file that is already stored returns the existing app, in its own team.

A session that names an app from the library by its id gets it only if it can see that app. An app it can't see is passed on to the driver as written, exactly as an unknown id is.

## Deleting a team

A team can be deleted only when it has no phones, no members and no apps, so that nothing is shared with everyone by accident. Otherwise the answer says what is left:

```json
{"error":"Team still has 2 device(s), 3 member(s) and 1 app(s). Reassign them before deleting."}
```

Move the phones back to the shared pool, take the members out and move the apps, then delete the team.

## What a test gets

A session is given a phone by the same rule as the dashboard, for the person behind its credentials. A member's session gets the shared pool and their teams' phones. An admin's session gets any phone. The credentials go in `xe:options`, as the [Quick start](./quick-start.mdx#4-point-a-test-at-it) shows.

- **A token's team.** A token's reach is its owner's reach. A token that is bound to a team narrows a member's token to that team and the shared pool. It can't give more than its owner has: an admin's token reaches every phone, whatever team it carries.
- **Naming a team.** `xe:options.team` narrows a session to that team's phones and the shared pool. A member can name only a team they belong to. Anything else fails the session with `xe:options.team '<id>' is not allowed for this API key`.

  ```js
  'xe:options': {
    accessKey: process.env.XENON_ACCESS_KEY,
    token: process.env.XENON_TOKEN,
    team: '3acef541-...',
  },
  ```

- **No credentials.** A session that presents none is still admitted unless `XENON_REQUIRE_SESSION_TOKEN` is on, and the team rule doesn't narrow it. It has no owner, though, so nobody except an admin can control its phone, including the person who started it. Send credentials, or turn that setting on to refuse such sessions.
- **No phone matches.** When no phone the session may use is free, it waits and then fails, as [Devices and allocation](./devices.md#when-no-phone-is-free) describes. The error doesn't say that other teams' phones exist.

## Related

- [Roles and scopes](./roles-and-scopes.md): what each role and scope allows.
- [Authentication](./authentication.md): the credentials a test sends.
- [Devices and allocation](./devices.md)
- [Leases for CI](./leases.md)
