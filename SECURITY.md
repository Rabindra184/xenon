# Security policy

## Supported versions

Security fixes go into the latest minor release on npm. Upgrade to it before
reporting a problem; the [changelog](CHANGELOG.md) says what changed and
whether a release brings a database migration.

| Version | Supported           |
| ------- | ------------------- |
| 2.15.x  | Yes                 |
| Older   | No; upgrade to 2.15 |

## Reporting a vulnerability

**Please don't open a public issue for a security problem.** Report it
privately through GitHub instead:
[**Report a vulnerability**](https://github.com/Rabindra184/xenon/security/advisories/new).

Include what you can of:

- the version of Xenon, and whether it runs as a hub, a node or alone;
- what an attacker can do, and what they need first (a member's account, a
  network position, an API key with which scopes);
- steps or a request that shows it.

We'll acknowledge your report, keep you posted on the fix, and once it is
released publish an advisory crediting you, unless you'd rather not be named.

## Running Xenon safely

Xenon controls real devices and holds test credentials, so treat a lab like
any other internal service:

- Set `XENON_BOOTSTRAP_ADMIN_EMAIL` and `XENON_BOOTSTRAP_ADMIN_PASSWORD`
  before the first start, or change the default admin's password at once.
- Never set `XENON_AUTH_DISABLED` on a server others can reach.
- Turn on `XENON_REQUIRE_SESSION_TOKEN` so every Appium session has an owner,
  and `XENON_REQUIRE_COMMAND_AUTH` on the hub so every command is checked.
- Serve the hub over HTTPS, and keep nodes on a network you trust: a session's
  WebSocket address points at its node.
- With `XENON_SMTP_URL` set, set `XENON_PUBLIC_URL` to the server's address
  (`https://xenon.example.com`, `http://lab-mac:4723`): password reset links
  point there, and without it Xenon emails none.
- Give API tokens only the scopes they need, and an expiry.
