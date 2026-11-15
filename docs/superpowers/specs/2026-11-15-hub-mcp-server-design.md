# Xenon's own MCP server, part 1: installed in any coding agent

Status: draft for review, 2026-11-15. Builder check done; its questions are answered below (calls marked "call"). First of four projects: (1) install
anywhere, with where it sits next to `appium-mcp`; (2) folded into 1; (3)
agents get more done (evidence, a compact screen view, steps to a test); (4) a
setup-and-info helper. 3 and 4 add tools to the server this project builds.

## Why

Win teams that use `appium-mcp` or WebdriverIO's MCP by making their AI agents
get more done on a Xenon lab. The first thing in the way is installing it.

Today an agent reaches Xenon only through Xenon Studio
(`XAenon/xenon-studio`): `appium-mcp` plus a plugin with 8 `xenon_*` tools,
served in lab mode by `hosted-mcp`, a Docker gateway each lab deploys beside
its hub. Four problems:

- **A separate service per lab.** Someone has to deploy and run the gateway.
  It also composes `appium-mcp`'s auth layer through internals
  (`loadAuthInternals`), so an `appium-mcp` upgrade can break it.
- **A token that expires daily.** The agent's config carries a `xenon-mcp`
  bearer, 24 h by default (`XENON_MCP_TOKEN_TTL_SEC`). Each user makes a new
  one and pastes it into every agent, every day.
- **Nothing to install.** Neither `@xenon/appium-mcp-plugin` nor
  `xenon-studio` is on npm. Outside VS Code and Cursor (the extension), setup
  is hand-editing config files from a long guide (`docs/deploy/ide-setup.md`).
- **Skills for three agents only:** Claude Code, Cursor, Copilot
  (`xenon-skills/src/render.ts`). Codex, Gemini CLI and the rest get none.

## Who it's for

**First: a tester at a company that runs a Xenon lab.** Winning a team means
winning the people who share one lab. (Call made in the conversation: the
user handed it over.)

**On-ramp: a developer with one phone,** who today uses `appium-mcp` locally.
Xenon is an Appium plugin, so a local Xenon is a lab of one. This project
documents that path (install Xenon, start it, add it to the agent); a tool
that sets up local Xenon for them is not in this project.

## Goals

1. One step per agent to add Xenon: **Claude Code, Codex, Cursor, VS Code
   (Copilot), Gemini CLI, Windsurf, Claude Desktop.**
2. **Sign-in through the browser,** against the dashboard's own login. No
   token in any config file on the normal path, and nothing to renew by hand.
3. **No extra service:** the hub serves MCP itself.
4. **Headless agents (CI) work** with an API credential, without a browser.
5. **Skills install with the server,** in each agent's own format.
6. **Pairs cleanly with `appium-mcp`:** an agent keeps `appium-mcp` for
   driving and gets Xenon's lab tools beside it, and `appium-mcp` sessions it
   starts run on the lab as the signed-in user.
7. Existing Studio users keep working through the switch.

## Non-goals (later projects)

- Agent-built driving tools and the compact screen view (project 3).
- Evidence tools: session report, failure analysis, logs, video, network
  capture, steps to a test (project 3).
- Admin and setup tools (project 4).
- A tool that installs and starts a local Xenon for a one-phone developer.
- Replacing `appium-mcp`.
- Reaching a private hub from internet-hosted agents (claude.ai web
  connectors, ChatGPT): the agent must be able to reach the hub's URL.

## Anti-goals (a failure even if it works)

- A token pasted into a config file on the normal path.
- A second service to deploy.
- A tool that sees or acts on what REST would refuse the same user: team
  boundaries, ownership, leases and scopes apply exactly as on REST.
- Breaking a Studio user without one release of overlap.

## Constraints

- No runtime dependency may need its install script (CLAUDE.md, "No runtime
  dependency may need its install script"). `@modelcontextprotocol/sdk`
  1.32.x is plain JavaScript; its tree must pass `install-scripts.spec.ts`.
- No new unique constraint beyond a new table's primary key
  (`db push` refuses one on a database without migration history).
- Appium 3, both Express shapes; Node `^20.19 || ^22.12 || >=24`; SQLite.
- Mounted under `/xenon`, which is not under Appium's base path.

## Approaches

| | What | Trade-off |
|---|---|---|
| **A. The hub serves MCP (picked)** | Xenon's plugin answers MCP at `/xenon/mcp`, with OAuth sign-in against the dashboard login. | Most work, and new security surface on the hub. Removes the gateway and the daily token for every agent at once; tools live beside the data, versioned with the hub, so projects 3 and 4 add tools in one place. |
| B. A standalone npm package | `npx` server with Xenon's tools only, calling the hub's REST; `xenon login` keeps a key in the keychain. | No hub change, but two servers on every machine, version drift from the hub, and poor for CI. |
| C. Polish today's gateway | Publish `hosted-mcp`, add token renewal and an installer. | Least work; keeps a service per lab and the dependency on `appium-mcp`'s internals. |

The user picked A. A small installer package (below) comes with it.

## Design

### 1. The endpoint

- **`/xenon/mcp`**, MCP Streamable HTTP, served by the plugin on a hub or
  standalone server, whatever `enableDashboard` says (as `/xenon` is). A node
  doesn't serve it: its phones are reached through the hub's services.
- **Stateless:** each POST is answered on its own (JSON, or an SSE stream for
  a long tool call), with no server-side MCP session. Any hub process can
  answer, and a restart loses nothing. GET (a standing server stream) answers
  405 until a tool needs server-initiated messages.
- **Protocol version** follows the SDK's latest; the builder records which.

### 2. Sign-in (OAuth 2.1, the MCP authorization spec)

The hub is both the resource server and the authorization server.

- **Discovery:**
  - An unauthenticated call answers `401` with `WWW-Authenticate` naming the
    protected-resource metadata.
  - Protected-resource metadata (RFC 9728) at
    `/.well-known/oauth-protected-resource/xenon/mcp`, plus the root form.
  - Authorization-server metadata (RFC 8414) at
    `/.well-known/oauth-authorization-server`.
  - These documents name the hub by `XENON_PUBLIC_URL`
    (`src/services/publicUrl.ts`) when set, else by the request, read with
    `trustProxy` (2.37) behind a reverse proxy.
- **Plain HTTP** (call: many labs run `http://lab-mac:4723`). OAuth expects
  HTTPS except on loopback, and an agent may refuse a plain-HTTP
  authorization server. So the installer connects agents to a hub on plain
  HTTP through its own `relay` (section 5), which signs in from the user's
  machine and accepts HTTP; agents talk to the relay on stdio. A hub on HTTPS
  is added directly. The docs recommend HTTPS and say what plain HTTP
  exposes on the network (the same as API keys today).
- **Clients:** dynamic client registration (RFC 7591) and client ID metadata
  documents (an `https` URL as `client_id`), since current agents use one or
  the other. Registered clients are capped (per address and in total) and
  dropped after 30 days unused.
- **Authorize** (`/xenon/api/oauth/authorize`, then a dashboard page):
  - The dashboard's sign-in if not signed in, then a consent page naming the
    agent, the hub and the scopes asked for, with Allow / Deny.
  - PKCE `S256` required. `resource` (RFC 8707) must be this hub's MCP URL.
  - Redirect URIs: loopback (`127.0.0.1`, `[::1]`, `localhost`, any port),
    `https`, and the custom schemes a client registered. Exact match
    otherwise.
  - Consent is a POST with the CSRF rules the dashboard already uses.
- **Tokens** (`/xenon/api/oauth/token`, `/revoke`):
  - **Access token:** the existing `xenon-mcp` RS256 JWT (`JwtKeyService`),
    one hour, `scope` = the granted MCP scopes within what the user's role
    allows (`mcpScopes.ts` and `scopesForRole`). REST and per-command auth
    already accept it.
  - **Refresh token:** opaque, rotated on every use. 30 days unused or 90
    days in all (builder makes both configurable). Stored hashed in a new
    `McpGrant` table: id (primary key), user, client, scopes, hash, created,
    last used, expires, revoked, rotated-from. A refresh token presented a
    second time revokes its whole chain.
  - Every refresh and every call looks the user up, as REST does: an
    Inactive or deleted user is refused at once. `identityChanged(userId)`
    revokes that user's grants when they go Inactive or are deleted.
  - **Revoking a grant takes effect at once** (call). The access token
    carries the grant's id (`gid`). `verifyBearerCredential`, which REST,
    per-command auth and `/xenon/mcp` all use, refuses a token whose grant
    is revoked, from a cache that a revoke clears (no wait). A token without
    `gid` (minted by `POST /auth/token`) is checked as today.
- **Seeing and revoking grants:** `GET /xenon/api/oauth/grants` (own),
  `DELETE /xenon/api/oauth/grants/:id`; an admin may revoke any user's. A
  "Connected agents" list with Revoke in the dashboard (where a user manages
  their own sign-ins; builder picks the spot within Settings' rules).
- **Auth disabled:** no sign-in, no metadata; tools act as the synthetic
  SUPER_ADMIN, as REST does.
- **Headless (CI):** the endpoint also takes what `authMiddleware` takes: a
  `xenon-mcp` or `xenon-rest` bearer, the key pair headers, or Basic. No
  browser involved.

### 3. Tools in this project

Ported from `@xenon/appium-mcp-plugin` with the **same names and argument
shapes**, so skills and prompts written for Studio keep working:

| Tool | MCP scope |
|---|---|
| `xenon_list_devices` | `xenon:devices:read` |
| `xenon_acquire_device` (a lease) | `xenon:devices:lock` |
| `xenon_release_device` | `xenon:devices:lock` |
| `xenon_selector_health` | `xenon:analytics:read` |
| `xenon_healing_events` | `xenon:analytics:read` |
| `xenon_start_recording` / `xenon_stop_recording` | `xenon:recordings` |
| `xenon_execute_script` (Xenon's `xe:` scripts on a session the caller owns) | `xenon:execute` |

**An agent's lease lasts until it is released** (the user's choice). Agents
don't send heartbeats, and a stateless hub can't send them for the agent: a
Studio lease today lapses about 90 s after acquire unless a session starts
on the phone. So a lease taken through `/xenon/mcp` is a heartbeat-free
lease:

- It ends when the agent calls `xenon_release_device`, at its `expiresAt`
  (15 minutes by default; `durationMs` may ask for another, within the lease
  limits), or when its grant is revoked or its user goes Inactive.
- The lease records the grant it was taken under. `LeaseOrphanSweeper` skips
  the missed-heartbeat rule for it and ends it at `expiresAt`; revoking the
  grant ends its leases at once (`releaseLeaseLock`, as a release does).
- Everything else is a lease as today: allocation, the ownership guard,
  recordings and the queue treat it as any live lease; a session started on
  it claims the phone, and keeps it if the lease ends first.
- Heartbeat-based leases (`POST /sdk/leases` from the SDK) are unchanged.
- One new tool, `xenon_extend_device` (`xenon:devices:lock`), moves the end
  out by `LeaseService.extend`'s rules (never shorter, at most 24 h after
  creation).
- The lab skill tells the agent to release a phone when it is done, and
  `xenon_list_devices` shows the caller their own leases with time left.
- Schema: two nullable columns on `Lease` (the grant id, and that it needs
  no heartbeats). No unique constraint.

Two more new tools:

- **`xenon_session_capabilities`** (`appium:use`): what an `appium-mcp`
  create-session call needs to run on the lab as the signed-in user: the
  hub's WebDriver URL with its base path (`remoteServerUrl`), and
  capabilities carrying a fresh `xe:options.sessionToken` (audience
  `xenon-session`), plus `leaseId`, `leaseToken` and `leaseMember` when
  given a lease.
  - **Hubs with per-command auth on** (`XENON_REQUIRE_COMMAND_AUTH`, call).
    After the create, `appium-mcp` sends no headers; the only credential it
    can send is Basic auth from `user:password` in `remoteServerUrl`. So the
    tool puts the same session token in the URL as the Basic password (user
    `xenon-session`), and per-command auth accepts a Basic password that is
    a valid `xenon-session` token, for sessions its user owns, as it accepts
    a bearer. This adds no new secret to the agent's context: the session
    token is already in the capabilities. The token lasts as long as the
    tokens `POST /auth/token` mints (`XENON_MCP_TOKEN_TTL_SEC`), so a
    session that outlives it is refused after that; the docs say so.
- **`xenon_lab_info`** (any signed-in caller): hub version, the features
  `/capabilities` reports, who the caller is, their teams and granted scopes.

Rules for every tool:

- It runs in process, through the same services and access rules as the REST
  route it mirrors: team visibility, ownership, leases, scope. Never an HTTP
  call back to the hub.
- It declares its MCP scope and MCP annotations (read-only, destructive).
  A tool outside the token's scopes is not listed.
- A refusal is a tool error with REST's code and message (`not_found` for a
  hidden phone, as REST gives), never a thrown protocol error.
- Each call is a span (`TracingService`) and an event-log entry: user, tool,
  outcome, duration. No arguments, no answer (typed text and captured
  traffic stay out, as the event log's rules require).
- Rate-limited per user.

### 4. Next to `appium-mcp`

The documented pairing: `appium-mcp` drives, Xenon provides the lab.

1. The agent calls `xenon_acquire_device` (optional) and then
   `xenon_session_capabilities`.
2. It passes the URL and capabilities to `appium-mcp`'s create-session tool.
   (Studio's spike B showed `remoteServerUrl` comes only from the tool call,
   and that `xe:options.sessionToken` reaches the hub unchanged.)
3. Commands go through the hub, so autowait, healing, the command log, video
   and device logs apply, and the session belongs to the user.

A skill teaches this order. The installer can add `appium-mcp` too.

### 5. The installer: `@xenon-device-management/mcp`

In the `xenon-studio` repo, published to npm. The name is a call: `@xenon`
isn't this project's npm scope; the plugin is `@xenon-device-management/xenon`.

- **`npx @xenon-device-management/mcp add --hub <url>`** finds the installed
  agents and asks which to set up (`--client <name>` / `--all` for scripts).
  For each it uses the agent's own command where there is one, else its
  config file:

  | Agent | How |
  |---|---|
  | Claude Code | `claude mcp add --transport http xenon <hub>/xenon/mcp` (scope flag passed through) |
  | Codex | `codex mcp add xenon --url …`, then `codex mcp login xenon` |
  | Gemini CLI | `httpUrl` entry in `~/.gemini/settings.json`; it signs in on first use (`/mcp auth`) |
  | Cursor | `url` entry in `~/.cursor/mcp.json` (or the install deep link) |
  | VS Code | `code --add-mcp '{"name":"xenon","type":"http","url":…}'` |
  | Windsurf | `serverUrl` entry in its `mcp_config.json` |
  | Claude Desktop | a stdio entry running this package's `relay` (below) |

  The builder checks each agent's current command and file before building:
  these move often.
- **No token is written on the normal path.** `--token-env NAME` (CI) writes
  a header that references the variable, in the agent's own syntax, never
  the value.
- **`relay`:** a stdio-to-HTTP bridge for an agent that can't connect to a
  URL or sign in itself. It does the OAuth flow with a loopback redirect and
  keeps the tokens in the system keychain.
- **Skills:** each skill is one `SKILL.md` in the Agent Skills format, from
  `xenon-skills` (the single source, as today). `add` installs them where
  each agent reads skills, and as a rules file where an agent has no skills
  (Cursor rules, Copilot instructions). Stamped with a version;
  `update` and `remove` keep them in step. A new skill teaches the
  `appium-mcp` pairing above.
- **`doctor`:** the hub answers, it serves MCP (`features.mcpServer`), and
  each set-up agent is signed in.
- **`--with-appium-mcp`:** also adds `appium-mcp` (pinned) to the same
  agents.

### 6. Telling clients and users

- `/capabilities`: `features.mcpServer` (`{ path, oauth, contractVersion,
  tools }`), flag `mcp-server`.
- **A dashboard page, "AI agents",** for every signed-in user: the commands
  above with this hub's URL filled in, one copy button per agent, and the
  user's connected agents. This is where a tester starts.

### 7. Xenon Studio and the gateway

- **Lab mode registers two servers** (call), the pairing in section 4: the
  hub's `/xenon/mcp` for the lab tools, and a local `appium-mcp` (the one
  local mode already provisions, pinned) for driving. The gateway ran
  `appium-mcp` itself, so pointing lab mode at the hub alone would leave
  Studio users unable to drive a phone.
- The gateway's lab-only behaviour moves with it: the local `appium-mcp`
  hides `appium_get_page_source` (its policy allowlist), the lab skill tells
  the agent to pass `sessionId` explicitly, and audit is the hub's own event
  log (section 3), so `POST /audit/events` shipping isn't needed for these.
- **The overlap** (call): the extension uses the gateway when the hub
  doesn't report `features.mcpServer`, for two Studio minor releases after
  the hub release that ships this. `hosted-mcp` is marked deprecated at that
  hub release and removed from `xenon-studio` with the second of those
  Studio releases.

### 8. Documentation

- `website/docs/ai-agents.md` rewritten: a quick start with a tab per agent,
  sign-in, revoking an agent, CI, scopes, pairing with `appium-mcp`, and a
  tool reference (each tool, its scope, its arguments, an example).
- A short "one phone on your desk" section: install Xenon, start it, run the
  installer against `http://localhost:4723`.
- README: a three-line "Use Xenon from your AI agent" section.
- The API reference documents the OAuth and grant routes
  (`openapi-coverage.spec.ts`).

## Testing

- **Sign-in end to end** with the MCP SDK's own client and its OAuth helper,
  against a real hub in a test: registration, PKCE, consent, token, refresh,
  rotation, reuse revoking the chain, an Inactive user refused, expiry.
- **Refusals:** a wrong redirect, a missing or plain PKCE, a wrong
  `resource`, a code used twice, CSRF on consent.
- **Tools:** each against REST's own answer for the same user, a member on a
  hidden phone included (identical not-found), and a token without the scope
  (tool not listed, call refused).
- **Installer:** each agent's config written into a scratch home, never a
  token in it; commands run against fake `claude`, `codex` and `code`.
- **Before release, by hand:** Claude Code, Codex, Cursor, VS Code and
  Gemini CLI each added, signed in, and running `xenon_list_devices` against
  a real hub.

## Risks

- **The OAuth server is security-critical.** Use the SDK's server-side auth
  building blocks where they fit; review the endpoints adversarially before
  release.
- **The MCP spec and agents move.** Registration styles and config files
  change every few months. Discovery is standard; per-agent knowledge lives
  only in the installer, which can ship weekly.
- **The agent must reach the hub.** A hub behind a VPN works for IDE agents
  on the VPN, not for internet-hosted ones (a non-goal).

## Left to the builder

- Exact refresh lifetimes, rate limits and client caps (defaults above).
- Where "Connected agents" and "AI agents" sit in the dashboard, within the
  Settings and sidebar rules in CLAUDE.md.
- The protocol version and how much of the SDK's auth code to reuse.
- Each agent's current command and file.

## Rough cost

Hub endpoint and tools, 1 to 2 weeks. Sign-in, 1 to 2 weeks. Installer and
skills, about a week. Dashboard page and docs, a few days.
