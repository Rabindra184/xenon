---
title: Hardening checklist
description: What to set before other people can reach a Xenon server, from the first admin's password to per-command checks, HTTPS, nodes, tokens, teams, secrets and reporting a vulnerability.
---

Xenon drives real phones, and keeps test credentials, app builds and screen recordings. Unless you tell it otherwise, anyone who can reach its port can start a test session on your phones. This checklist is what to set before people other than you can reach a server, a hub and its nodes included. Each item says why, and links to the page with the details. Running it for others in general (layout, backups, HTTPS, sizing) is on [Production deployment](./deployment.md).

## The checklist

- [Set the first admin's password before the first start](#set-the-first-admins-password-before-the-first-start)
- [Keep sign-in on](#keep-sign-in-on)
- [Give every session an owner](#give-every-session-an-owner)
- [Check every command on the hub](#check-every-command-on-the-hub)
- [Keep secrets out of Appium's log](#keep-secrets-out-of-appiums-log)
- [Serve Xenon over HTTPS, through a proxy](#serve-xenon-over-https-through-a-proxy)
- [Keep nodes on a trusted network](#keep-nodes-on-a-trusted-network)
- [Use tokens with the least they need](#use-tokens-with-the-least-they-need)
- [Use teams](#use-teams)
- [Cut off someone who leaves](#cut-off-someone-who-leaves)
- [Keep secrets in environment variables](#keep-secrets-in-environment-variables)
- [Protect the data folder](#protect-the-data-folder)
- [Keep Xenon up to date](#keep-xenon-up-to-date)
- [Report a vulnerability privately](#report-a-vulnerability-privately)

## Set the first admin's password before the first start

The first time Xenon starts with an empty database it makes a Super admin from `XENON_BOOTSTRAP_ADMIN_EMAIL` and `XENON_BOOTSTRAP_ADMIN_PASSWORD`. Without them, that account is `admin@xenon.local` with the password `Admin@123`, which anyone can look up. Set both in the environment before the first start:

```bash
export XENON_BOOTSTRAP_ADMIN_EMAIL="you@example.com"
export XENON_BOOTSTRAP_ADMIN_PASSWORD="a-long-passphrase-of-your-own"
```

Xenon reads them only when it makes that first user. If the server already started without them, sign in as `admin@xenon.local` at once and change the password on **Profile**, **Password & authentication**. [Authentication](./authentication.md#sign-in-and-passwords) covers sign-in and passwords.

## Keep sign-in on

Never set `XENON_AUTH_DISABLED=true`, or the `authDisabled` option, on a server anyone else can reach. With either one, every caller is a Super admin without a password, the team rule is off, and test sessions have no owner. A server running this way logs `Authentication is DISABLED` when it starts. See [Turning sign-in off](./authentication.md#turning-sign-in-off).

## Give every session an owner

Set `XENON_REQUIRE_SESSION_TOKEN=true`. Without it, anyone who can reach Appium's port can start a session on your phones without credentials, and a session with missing or wrong credentials runs with no owner: only an admin can then control its phone, including the person who started the test. With it, a session needs a valid access key and token, or a session token, in `xe:options`. On a hub with nodes, set it on the hub.

Kotlin SDK tests work with it as long as `xenon.attachSessionCredentials` stays `true`. See [Refuse sessions without credentials](./authentication.md#refuse-sessions-without-credentials).

## Check every command on the hub

Set `XENON_REQUIRE_COMMAND_AUTH=true` on the hub, or on the one server of a single-machine lab. Without it, Xenon checks credentials only when a session is created, and anyone who learns a session's id can drive the session, read its screen and end it. With it, every command must come from the session's owner or an admin, and anyone else is told the session doesn't exist.

It requires every client to send its credentials as headers with every command, not only in the capabilities when the session is created. Check your clients before you turn it on. The [Kotlin SDK](./kotlin-sdk.mdx#what-you-need) doesn't send them, so its sessions fail with `404 invalid session id` after the create: leave this off on a server where Kotlin SDK tests run. [Check every command](./authentication.md#check-every-command) shows how a client sends the headers.

Turn on Appium's `session_discovery` insecure feature only if you need it. It lists every running session's id and capabilities to anyone who asks. With per-command checks on, Xenon shows each caller only their own sessions.

## Keep secrets out of Appium's log

Appium writes the body of every request to its log before Xenon sees it. The dashboard marks its requests that carry a password or a key, so Appium leaves their bodies out. Scripts that sign in or set passwords have to mark theirs too, and the token of every test session that sends one is logged unless the request that creates the session is marked too, or a filter hides it. Give Appium the two `log-filters` rules in [Keep secrets out of Appium's log](./authentication.md#keep-secrets-out-of-appiums-log). Webhook addresses, and text typed on a phone or written to its clipboard through device control, are logged as sent, and the rules don't hide them, so still limit who can read the log and where it is shipped.

## Serve Xenon over HTTPS, through a proxy

Put a reverse proxy with HTTPS in front of the hub, and let only the proxy reach Appium's port. [HTTPS behind a reverse proxy](./deployment.md#https-behind-a-reverse-proxy) has an nginx example. For security, the proxy has to:

- **Set `X-Forwarded-Proto`,** so the sign-in cookie is marked `Secure`.
- **Set `X-Forwarded-For` itself,** overwriting what the client sent. Xenon limits sign-in attempts per client address and takes the address from that header, so a client that could set it could dodge the limit.
- **Keep the `Host` header, port included,** or list the dashboard's address in `XENON_ALLOWED_ORIGINS`. Changes made with the dashboard's cookie are accepted only from the server's own address: see [Requests from a browser](./authentication.md#requests-from-a-browser).
- **Serve Xenon only under its own name.** A password reset link in an email is built from the `Host` header of the request that asked for it, so the proxy should refuse every request whose `Host` names another host. The [nginx example](./deployment.md#https-behind-a-reverse-proxy) does this with a default server, and a check of `Host` in Xenon's own server.

## Keep nodes on a trusted network

A hub reaches each node over plain HTTP, at the address the node reports, and a session's `webSocketUrl` points straight at its node. Keep nodes on a private network and never expose one to the internet.

- Give each node its own user on the hub, with the Admin role, not Super admin, and a token that expires. See [Give each node a user and a token](./hub-and-nodes.md#give-each-node-a-user-and-a-token).
- Point each node at the hub's HTTPS address, and leave the `tlsRejectUnauthorized` option at `true`, so a node checks the hub's certificate. A node checks the hub's tokens with the keys it fetches from that address.

[Hub and nodes](./hub-and-nodes.md#security) explains how a hub and its nodes trust each other.

## Use tokens with the least they need

- **One token per script or pipeline,** so you can revoke one without breaking the others.
- **Only the scopes it needs.** A pipeline that only runs tests needs `sessions`. `devices` is for scripts that lease, reserve, record or control phones, and `admin` only for scripts that manage the lab. Name the scopes with `POST /xenon/api/profile/tokens` and `scopes`: see [Make an access key and token](./authentication.md#make-an-access-key-and-token). Leaving `sessions` out doesn't stop a credential from running test sessions, though: a session token can be made from any credential, and sessions created with one aren't checked for that scope.
- **An expiry.** The Profile page offers 7 days to a year, and the API takes any date. An expiry limits how long a token works, not what it can do meanwhile: while it is valid, it can be used to make new tokens with any expiry, or none. So treat a short-lived token with the same care as a long-lived one.
- **Review the API keys page now and then.** It lists every token in the lab with when it was last used, and counts those with the `admin` scope at the top. Revoke what nobody uses.
- **Demoting someone doesn't change their tokens.** A former Admin keeps any key with the `admin` scope, which still counts as an admin's for other people's phones and sessions. Revoke those keys when you change the role.

[Roles and scopes](./roles-and-scopes.md) lists what each scope allows.

## Use teams

Give each group's phones and apps to a team. A Member then sees and uses only the shared pool and their teams' phones, and everything else answers as if it didn't exist. Their test sessions keep to those phones too once [every session needs credentials](#give-every-session-an-owner): a session sent with no credentials can be given any phone. New phones arrive in the shared pool, so give them a team when they are plugged in. See [Teams](./teams.md).

## Cut off someone who leaves

Delete the person on the **Users** page. That removes their account and every token they made, and their sign-ins and bearer tokens stop at once.

- Setting them to **Inactive** isn't enough on its own: it stops their sign-in and their tokens on the dashboard and `/xenon/api`, but their access key and tokens can still create Appium sessions.
- A session token they were already given keeps working for test sessions until it expires, after 24 hours by default (`XENON_MCP_TOKEN_TTL_SEC`).
- With [per-command checks](./authentication.md#check-every-command) on, their running sessions stop accepting their commands within 30 seconds.
- A live preview or log stream they already have open keeps running until it closes, and a dashboard they have open keeps receiving live device and session updates until it is reloaded or its connection drops.

## Keep secrets in environment variables

Put credentials in the environment of the process that runs Appium, not in an Appium config file or a command line: the AI provider keys (`XENON_GEMINI_API_KEY`, `XENON_OPENAI_API_KEY`, `XENON_ANTHROPIC_API_KEY`), a node's `XENON_HUB_ACCESS_KEY` and `XENON_HUB_TOKEN`, `XENON_SMTP_URL` and the bootstrap password. Appium prints every option that isn't at its default when it starts, Xenon's included, and config files get copied and committed. [Xenon Control](./xenon-control.md) keeps these secrets encrypted and hands them to the server as environment variables. [Environment variables](./environment-variables.md) lists them all.

- Leave `XENON_PASSWORD_RESET_LOG_FALLBACK` off. It writes password reset links, which open the account, to the server log.
- Set `XENON_IP_HASH_SECRET` to a random value of your own. Xenon keeps, with each sign-in, a hash of the client's address made with it, and the default is the same on every server.

## Protect the data folder

Everything Xenon keeps is under `~/.cache/xenon` of the user that runs Appium, unless you moved it. Only that user should be able to read it, and backups of it need the same care:

- `xenon.db` holds the users with their password hashes, the hashes of every token, and the sessions.
- `xenon-jwt-private.pem` signs bearer tokens, session tokens, tickets and a hub's tokens to its nodes. Anyone who has it can make tokens Xenon accepts, for any user.
- `interceptor-ca/` holds the private key of the certificate authority network capture signs with.
- `assets/` holds session videos, screenshots and recordings, which show whatever was on the phones' screens.

[Where Xenon keeps its data](./deployment.md#where-xenon-keeps-its-data) says how to move each of them.

## Keep Xenon up to date

Security fixes go into the latest minor release on npm, not into older ones. The release notes say what each release fixes and what runs where, so you know whether to upgrade the hub, the nodes or both. See [Release notes](./release-notes.md) and [Upgrading](./upgrading.md).

## Report a vulnerability privately

Don't open a public issue for a security problem. Report it privately through GitHub: [Report a vulnerability](https://github.com/Rabindra184/xenon/security/advisories/new). Include what you can of:

- the version of Xenon, and whether it runs as a hub, a node or alone;
- what an attacker can do, and what they need first, such as a member's account, a position on the network, or an API key with given scopes;
- steps or a request that shows it.

You'll get an acknowledgement and news of the fix, and once it is released an advisory credits you, unless you'd rather not be named. The project's [security policy](https://github.com/Rabindra184/xenon/blob/main/SECURITY.md) has the details.

## Related

- [Authentication](./authentication.md)
- [Roles and scopes](./roles-and-scopes.md)
- [Teams](./teams.md)
- [Production deployment](./deployment.md)
- [Hub and nodes](./hub-and-nodes.md)
