# Xenon's own MCP server (hub side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Xenon hub serves MCP at `/xenon/mcp`, with browser sign-in (OAuth 2.1) or an API credential, and the lab tools agents use today through Xenon Studio's gateway.

**Architecture:** A stateless Streamable HTTP endpoint built on `@modelcontextprotocol/sdk`, mounted on the `/xenon` router beside `/api`. Each tool runs the REST route it mirrors in process (`invokeApi`), so team, ownership, lease and scope rules and their answers are REST's own. The hub is its own OAuth authorization server, assembled from the SDK's individual handlers (its `mcpAuthRouter` refuses a plain-HTTP issuer), with clients and refresh-token grants in two new tables.

**Tech Stack:** TypeScript 5.5, Express (Appium 3), Prisma/SQLite, `@modelcontextprotocol/sdk` 1.32.x, `jose`, Mocha/Chai/Sinon, React 17 + Vitest for the dashboard.

**Spec:** `docs/superpowers/specs/2026-11-15-hub-mcp-server-design.md`. The installer, skills and Studio changes are a second plan, in `xenon-studio`, after this one ships.

## Global Constraints

- No runtime dependency may need its install script; `test/unit/install-scripts.spec.ts` must stay green with the SDK's tree.
- No new unique constraint beyond a new table's primary key.
- New columns on existing tables are nullable.
- Appium 3, both Express shapes; Node `^20.19 || ^22.12 || >=24`; SQLite.
- Endpoint path `/xenon/mcp`; served on a hub or standalone server, not on a node.
- Access token: the existing `xenon-mcp` RS256 JWT, 1 hour, carrying `gid` (the grant id).
- Refresh token: opaque, rotated on every use, 30 days unused / 90 days in all, configurable by `XENON_MCP_REFRESH_IDLE_DAYS` / `XENON_MCP_REFRESH_MAX_DAYS`.
- PKCE `S256` required; `resource` must equal this hub's MCP URL.
- An agent's lease: no heartbeats, 15 minutes by default (`900000` ms), ends on release, `expiresAt`, grant revoked or user Inactive.
- Tool names and arguments as Studio's, `authToken` accepted and ignored.
- Every new route gets its operation in `src/app/openapi/*.yaml` (`openapi-coverage.spec.ts`); run `npm run build:openapi` after.
- Specs follow CLAUDE.md's test rules: `useScratchDatabase()` first in the describe, `reflect-metadata` imported, no root hooks, `test/helpers/loopbackRequest`.
- Dashboard copy is for testers (`wording.test.ts`); colours from role tokens.

## Review Focus

1. **A browser request carrying only the dashboard cookie to `/xenon/mcp`** must be refused `401`: the endpoint takes header credentials only, or any page could drive tools as the signed-in user. Test in Task 1.
2. **A client ID metadata document URL that resolves to a loopback, private or link-local address**, or answers over plain HTTP, redirects, or is larger than 64 KB, is refused at registration: the hub must not be a request forwarder. Test in Task 5.
3. **An authorization code used twice, or exchanged with another `redirect_uri` or `code_verifier`,** fails, and the second use of a code revokes the tokens the first issued. Test in Task 5.
4. **A hub behind a reverse proxy without `XENON_PUBLIC_URL`** names itself by the forwarded host and scheme only when `trustProxy` is set, and `resource` matches with or without a trailing slash. Test in Task 6.
5. **A member's agent naming another team's phone or session** gets exactly REST's not-found answer, never a different error. Test in Task 2.

---

### Task 1: The endpoint, its credentials, and `xenon_lab_info`

**Files:**
- Modify: `package.json` (add `@modelcontextprotocol/sdk` `^1.32.2`)
- Create: `src/mcp/mcpEndpoint.ts`, `src/mcp/toolRegistry.ts`, `src/mcp/tools/labInfo.ts`, `src/mcp/mcpCredential.ts`
- Modify: `src/app/index.ts` (mount `/mcp` on `router`, not `apiRouter`), `src/app/routers/capabilities.ts`
- Test: `test/unit/mcp-endpoint.spec.ts`

**Interfaces:**
- Produces:
  - `registerMcpEndpoint(router: express.Router, pluginArgs: IPluginArgs): void` — `POST /mcp` answers MCP; `GET` and `DELETE` answer `405`. Not registered when `pluginArgs` says this server is a node.
  - `McpCaller = { auth: AuthContext; grantId?: string }` (`AuthContext` is `req.auth`'s type; export it under that name from `authMiddleware.ts` if it has none).
  - `defineTool<A>(def: { name: string; scope: string | null; description: string; params: z.ZodType<A>; annotations: { readOnlyHint: boolean; destructiveHint: boolean }; run(args: A, caller: McpCaller): Promise<unknown> }): XenonTool`
  - `toolsFor(caller: McpCaller): XenonTool[]` — the tools whose `scope` the caller's token grants (null = any signed-in caller); with auth disabled, all.
  - `resolveMcpCaller(req): Promise<McpCaller | 'unauthenticated' | 'unavailable'>` in `mcpCredential.ts` — bearer (`xenon-mcp`, `xenon-rest`), the key pair headers or Basic, by the verifiers in `verifyCredential.ts` and `basicCredential.ts`. Never the cookie.

- [ ] **Step 1: Add the dependency and run the install-script check**

Run: `npm install @modelcontextprotocol/sdk@^1.32.2 && npx mocha test/unit/install-scripts.spec.ts`
Expected: PASS. If a package in its tree has an install script, add it to the spec's list with why it works without it, as the spec asks, or stop and report.

- [ ] **Step 2: Write the failing tests**

In `mcp-endpoint.spec.ts`, against a real Express app with `registerMcpEndpoint`, using the SDK's `Client` + `StreamableHTTPClientTransport` where a call should succeed:
- `lists xenon_lab_info for a key-pair caller` — `listTools()` names include `'xenon_lab_info'`.
- `answers xenon_lab_info with the caller and features` — result JSON has `userId` equal to the seeded user's id, `role`, `teams`, `scopes`, `version` equal to `package.json`'s, and `features.mcpServer.path === '/xenon/mcp'`.
- `refuses no credential with 401 and a resource-metadata challenge` — status `401`, header `www-authenticate` matches `/^Bearer resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/xenon\/mcp"/`.
- `refuses the dashboard cookie alone with 401` — a request with only `Cookie: xenon_dashboard_session=<a live session id>` gets `401` (Review Focus 1).
- `answers 503 when the signing key isn't ready` — with `JwtKeyService.ready` false and a bearer, status `503`, body `{ error: 'unavailable' }`.
- `answers GET with 405`.
- `is not registered on a node` — `404` for `POST /mcp` when the plugin args make the server a node.
- `serves every tool with auth disabled` — `authDisabled` true, no credential, `listTools()` succeeds.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx mocha test/unit/mcp-endpoint.spec.ts`
Expected: FAIL (`registerMcpEndpoint` not found).

- [ ] **Step 4: Implement the endpoint, the credential resolver, the registry and `xenon_lab_info`**

Stateless: one `McpServer` and one `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` per request, registering `toolsFor(caller)`. JSON body parsed with the router's own limit. `xenon_lab_info` reads `/capabilities`' feature object from the function that route uses (export it if it is inline). Add `features.mcpServer = { path: '/xenon/mcp', oauth: true, contractVersion: 1, tools: [names] }` and flag `mcp-server` to `/capabilities`.

- [ ] **Step 5: Run them to verify they pass**

Run: `npx mocha test/unit/mcp-endpoint.spec.ts test/unit/CapabilitiesRouter.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/mcp src/app/index.ts src/app/routers/capabilities.ts test/unit/mcp-endpoint.spec.ts
git commit -m "feat(mcp): the hub serves MCP at /xenon/mcp with xenon_lab_info"
```

### Task 2: Tools run REST in process; the read tools

**Files:**
- Create: `src/mcp/invokeApi.ts`, `src/mcp/tools/devices.ts` (list only, here), `src/mcp/tools/analytics.ts`, `src/mcp/toolCall.ts`
- Modify: `src/middleware/authMiddleware.ts` (honour a preset caller)
- Test: `test/unit/mcp-invoke-api.spec.ts`, `test/integration/mcp-read-tools.spec.ts`

**Interfaces:**
- Consumes: `defineTool`, `McpCaller` (Task 1).
- Produces:
  - `invokeApi(caller: McpCaller, call: { method: 'GET' | 'POST' | 'DELETE' | 'PUT'; path: string; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: any }>` — dispatches through the `/xenon/api` router in process (no socket), with `caller.auth` preset.
  - `PRESET_CALLER: unique symbol` — set on the request object by `invokeApi` only; `authMiddleware` takes `req[PRESET_CALLER].auth` as `req.auth` and skips credential parsing. A symbol, so nothing from the network can set it.
  - `mcpContextOf(req): McpCaller | undefined` — what a route reads to know a call came from an MCP tool.
  - `runTool(name: string, caller: McpCaller, fn: () => Promise<unknown>): Promise<CallToolResult>` in `toolCall.ts` — a span (`TracingService`), an event-log entry `{ type: 'mcp_tool_call', payload: { userId, tool, outcome, durationMs } }` (no arguments, no answer), the per-user rate limit (`rateLimitMiddleware`'s limiter, keyed by user), and REST's error turned into a tool error: `{ isError: true, content: [{ type: 'text', text: JSON.stringify({ error, message }) }] }` with REST's own `error` code and message.

- [ ] **Step 1: Write the failing tests**

`mcp-invoke-api.spec.ts`:
- `runs a route with the preset caller` — `invokeApi(caller, { method: 'GET', path: '/auth/me' })` returns status `200` and `body.userId === caller.auth.userId`.
- `ignores a header that tries to preset a caller` — an HTTP request to `/xenon/api/auth/me` with any header named like the symbol's description gets `401`.
- `passes route errors through` — `GET /devices/nope` style unknown route returns REST's `404` body unchanged.

`mcp-read-tools.spec.ts` (integration, `useScratchDatabase({ wholeSuite: true })`, `useOwnNodeId()`, a team phone and a shared phone seeded):
- `xenon_list_devices matches GET /devices for a member` — the tool's device udids equal REST's for the same member.
- `xenon_list_devices filters by platform, status and name` — as Studio's params do.
- `xenon_selector_health matches GET /healing/selector-health`.
- `xenon_healing_events refuses another team's session as REST does` — tool error body equals REST's `404` body for that session (Review Focus 5).
- `a token without xenon:analytics:read doesn't list the analytics tools`.
- `writes one mcp_tool_call event with no arguments` — the event payload has exactly `userId`, `tool`, `outcome`, `durationMs`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx mocha test/unit/mcp-invoke-api.spec.ts test/integration/mcp-read-tools.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `invokeApi`, the preset in `authMiddleware`, `runTool`, and the three read tools**

`invokeApi` builds an `http.IncomingMessage` (on a `net.Socket` that is never connected) and an `http.ServerResponse`, sets `req.body` with body-parser's already-parsed marker, collects what the response writes, and resolves on `finish`. Ported tools keep Studio's names, descriptions and zod params (`packages/appium-mcp-plugin/src/tools/{devices,analytics}.ts` in `xenon-studio`), with `authToken` made optional and ignored.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx mocha test/unit/mcp-invoke-api.spec.ts test/integration/mcp-read-tools.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp src/middleware/authMiddleware.ts test/unit/mcp-invoke-api.spec.ts test/integration/mcp-read-tools.spec.ts
git commit -m "feat(mcp): tools run their REST route in process; list devices, selector health, heals"
```

### Task 3: An agent's lease (no heartbeats, 15 minutes)

**Files:**
- Modify: `prisma/schema.prisma` (`Lease.heartbeatFree Boolean?`, `Lease.grantId String?`, `@@index([grantId])`), new migration via `npm run db:generate`
- Modify: `src/services/lease/leaseStatus.ts` (`missedHeartbeats`), `src/services/lease/LeaseService.ts` (`CreateLeaseRequest`), `src/app/routers/sdk-leases.ts`
- Modify: `src/mcp/tools/devices.ts` (acquire, release, extend)
- Test: `test/unit/lease/lease-heartbeat-free.spec.ts`, `test/integration/mcp-lease-tools.spec.ts`

**Interfaces:**
- Consumes: `invokeApi`, `mcpContextOf`, `runTool` (Task 2).
- Produces:
  - `CreateLeaseRequest.heartbeatFree?: boolean`, `CreateLeaseRequest.grantId?: string`.
  - `LeaseService.endLeasesOfGrant(grantId: string, reason: 'grant_revoked'): Promise<number>` — ends every waiting or active lease taken under the grant, through the release path (`releaseLeaseLock`), returns how many. Add `grant_revoked` to `LeaseEndReason`.
  - `MCP_LEASE_DEFAULT_MS = 900_000`.
  - Tools `xenon_acquire_device` (udid, host?), `xenon_release_device` (udid, lockId, leaseToken), `xenon_extend_device` (lockId, leaseToken, durationMs?).

- [ ] **Step 1: Write the failing tests**

`lease-heartbeat-free.spec.ts` (Prisma and Loki where a store is involved):
- `missedHeartbeats is false for a heartbeat-free lease` — `heartbeatFree: true`, `lastHeartbeatAt` an hour ago, `expiresAt` in the future → `activeLeaseEnd(...)` is `null`.
- `a heartbeat-free lease still ends at expiresAt` — reason `past_end`.
- `the sweeper keeps a quiet heartbeat-free lease and ends it at expiresAt`.
- `endLeasesOfGrant ends only that grant's leases, with reason grant_revoked`, and their phones are released by the lease rule (`busy` cleared where `UNHELD`).
- `POST /sdk/leases from a plain client ignores heartbeatFree` — body `{ heartbeatFree: true }` over HTTP makes a heartbeat lease.

`mcp-lease-tools.spec.ts`:
- `xenon_acquire_device makes a heartbeat-free lease of 15 minutes under the caller's grant` — row has `heartbeatFree: true`, `grantId` = the caller's, `expiresAt - createdAt` within 1 s of `900000`.
- `the acquire answer keeps Studio's shape` — `{ udid, host, lockId, leaseToken, appiumCapabilities }`.
- `xenon_extend_device moves expiresAt out by LeaseService.extend's rules` — never shorter.
- `xenon_release_device ends it`.
- `xenon_list_devices shows the caller's own leases with time left` — field `myLease: { lockId, expiresAt }` on that phone.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx mocha test/unit/lease/lease-heartbeat-free.spec.ts test/integration/mcp-lease-tools.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`sdk-leases` takes `heartbeatFree` and `grantId` only from `mcpContextOf(req)`, never the body, and uses `MCP_LEASE_DEFAULT_MS` when an MCP call gives no `durationMs`. Write the migration with `npm run db:generate`, then check both start paths by hand on a copy of a database with history and one without (CLAUDE.md, "Schema at startup").

- [ ] **Step 4: Run them to verify they pass**

Run: `npx mocha test/unit/lease/lease-heartbeat-free.spec.ts test/integration/mcp-lease-tools.spec.ts test/unit/lease`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma src/services/lease src/app/routers/sdk-leases.ts src/mcp/tools/devices.ts test/unit/lease/lease-heartbeat-free.spec.ts test/integration/mcp-lease-tools.spec.ts
git commit -m "feat(mcp): an agent's lease needs no heartbeats and lasts until released"
```

### Task 4: Recordings, `xenon_execute_script` and `xenon_session_capabilities`

**Files:**
- Create: `src/mcp/tools/recordings.ts`, `src/mcp/tools/execute.ts`, `src/mcp/tools/sessionCapabilities.ts`, `src/mcp/invokeWebDriver.ts`
- Modify: `src/app/routers/auth.ts` (extract `mintSessionToken`), `src/middleware/basicCredential.ts` and `src/middleware/commandCaller.ts` (a `xenon-session` token as the Basic password)
- Test: `test/integration/mcp-session-tools.spec.ts`, `test/unit/command-auth-session-basic.spec.ts`

**Interfaces:**
- Consumes: `invokeApi`, `runTool`, `PRESET_CALLER` (Task 2).
- Produces:
  - `mintSessionToken(auth: AuthContext): Promise<{ sessionToken: string; expiresIn: number }>` — what `issueToken` already does for `sessionToken`; `issueToken` calls it.
  - `invokeWebDriver(caller: McpCaller, sessionId: string, call: { method: 'POST'; path: string; body: unknown }): Promise<{ status: number; body: any }>` — dispatches into Appium's app in process at `<basePath>/session/<id>/<path>`, with the caller preset so per-command auth sees the owner; the session gateway forwards a node's session as usual; the command is logged as the session's own.
  - Tools `xenon_start_recording` (udids), `xenon_stop_recording` (groupId), `xenon_execute_script` (script, args?, sessionId), `xenon_session_capabilities` (lockId?, leaseToken?) → `{ remoteServerUrl, capabilities }`.

- [ ] **Step 1: Write the failing tests**

`mcp-session-tools.spec.ts` (with `useHubAndNode()` where a node session is needed, and a stand-in `SessionDeviceLogs`):
- `xenon_session_capabilities returns the WebDriver URL with the base path and a session token` — `remoteServerUrl` ends with the server's base path; `capabilities.alwaysMatch['xe:options'].sessionToken` verifies with audience `xenon-session` and `sub` = caller.
- `with a lease it adds leaseId, leaseToken and leaseMember`.
- `with per-command auth on, the URL carries xenon-session:<token> as Basic` — `new URL(remoteServerUrl).username === 'xenon-session'` and the password equals the session token; off, no user info.
- `xenon_execute_script runs xe:getAutowaitProperties on the caller's session` and the command appears in its command log.
- `xenon_execute_script on another user's session answers REST's unknown-session not_found`.
- `xenon_execute_script on a node's session is forwarded and answers`.
- `recording tools start and stop a group` — Studio's answer shape, `proofBundleUrl` under this hub.

`command-auth-session-basic.spec.ts`:
- `per-command auth accepts a xenon-session token as the Basic password for the owner's session`.
- `refuses it for a session the token's user doesn't own` — WebDriver unknown-session body.
- `refuses an expired or wrong-audience token` — same body.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx mocha test/integration/mcp-session-tools.spec.ts test/unit/command-auth-session-basic.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`remoteServerUrl` is `publicServerBase()` (or the request's origin, read as Task 6 reads it) plus Appium's base path. `invokeWebDriver` reaches Appium's app through the `expressApp` `ServerManager.registerRoutes` holds (keep a reference in `PluginContext`).

- [ ] **Step 4: Run them to verify they pass**

Run: `npx mocha test/integration/mcp-session-tools.spec.ts test/unit/command-auth-session-basic.spec.ts test/unit/command-auth*.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp src/app/routers/auth.ts src/middleware test/integration/mcp-session-tools.spec.ts test/unit/command-auth-session-basic.spec.ts
git commit -m "feat(mcp): recordings, execute script and session capabilities for appium-mcp"
```

### Task 5: Sign-in storage: clients, codes and grants

**Files:**
- Modify: `prisma/schema.prisma` (models `McpClient`, `McpGrant`), new migration
- Create: `src/services/oauth/clientStore.ts`, `src/services/oauth/clientMetadataDocument.ts`, `src/services/oauth/authCodes.ts`, `src/services/oauth/grantStore.ts`, `src/services/oauth/oauthProvider.ts`
- Test: `test/unit/oauth-client-store.spec.ts`, `test/unit/oauth-grants.spec.ts`, `test/unit/oauth-client-metadata-document.spec.ts`

**Interfaces:**
- Produces:
  - `McpClient { id String @id; name String; redirectUris String /* JSON */; createdAt DateTime; lastUsedAt DateTime }`; dropped after 30 days unused; at most 20 registrations per address per hour and 500 in all.
  - `McpGrant { id String @id; userId String; clientId String; scopes String; tokenHash String; createdAt DateTime; lastUsedAt DateTime; expiresAt DateTime; revokedAt DateTime?; rotatedFromId String?; @@index([userId]); @@index([clientId]) }`.
  - `class XenonOAuthProvider implements OAuthServerProvider` (the SDK's interface): `clientsStore`, `authorize`, `challengeForAuthorizationCode`, `exchangeAuthorizationCode`, `exchangeRefreshToken`, `verifyAccessToken`, `revokeToken`.
  - `AuthCodes.issue(input: { userId: string; clientId: string; redirectUri: string; codeChallenge: string; scopes: string[]; resource: string }): string` — single use, 60 s, in memory (a restart drops pending sign-ins).
  - `GrantStore.create(userId, clientId, scopes): Promise<{ grantId: string; refreshToken: string }>`, `rotate(refreshToken): Promise<{ grantId; refreshToken } | 'reused' | 'invalid'>`, `revoke(grantId, by: string): Promise<void>`, `revokeAllOf(userId): Promise<number>`, `listOf(userId)`.
  - `fetchClientMetadataDocument(url: string): Promise<ClientMetadata>` — https only, no redirects, 5 s, 64 KB, resolved address not loopback, private, link-local or unique-local; validated and cached 10 minutes.

- [ ] **Step 1: Write the failing tests**

- `a code works once` — second `exchangeAuthorizationCode` throws `invalid_grant`, and the grant the first created is revoked (Review Focus 3).
- `a code needs its own redirect_uri and verifier` — wrong `redirect_uri`, wrong verifier, or a `plain` challenge → `invalid_grant`.
- `a code expires after 60 s` (fake clock).
- `refresh rotates`: the old token is refused after use; `rotate` of a used token answers `'reused'` and revokes the chain (every grant linked by `rotatedFromId`).
- `refresh stops after 30 days unused and after 90 days in all` (fake clock; env overrides respected).
- `access tokens are xenon-mcp JWTs of one hour with gid and the granted scopes`, scopes cut to what `scopesForRole(user.role)` allows.
- `an Inactive user's refresh is refused`.
- `registration rejects a redirect URI that is neither loopback, https nor a custom scheme`.
- `client metadata documents`: refused for `http:`, a redirect, 65 KB, a host resolving to `127.0.0.1`, `10.0.0.5`, `169.254.1.1` or `fd00::1` (Review Focus 2); accepted for a valid https document (DNS stubbed).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx mocha test/unit/oauth-client-store.spec.ts test/unit/oauth-grants.spec.ts test/unit/oauth-client-metadata-document.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the models, migration, stores and provider**

Refresh tokens are 32 random bytes (base64url), stored as SHA-256. `verifyAccessToken` uses `verifyBearerCredential` (Task 7 adds the `gid` check there).

- [ ] **Step 4: Run them to verify they pass**

Run: same as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma src/services/oauth test/unit/oauth-*.spec.ts
git commit -m "feat(oauth): clients, single-use codes and rotating refresh grants for agents"
```

### Task 6: Sign-in routes, discovery and consent

**Files:**
- Create: `src/app/routers/oauth.ts`, `src/mcp/publicOrigin.ts`
- Modify: `src/services/ServerManager.ts` (`/.well-known` on Appium's app), `src/app/index.ts`, `src/app/openapi/identity.yaml`
- Test: `test/integration/oauth-flow.spec.ts`, `test/unit/mcp-public-origin.spec.ts`

**Interfaces:**
- Consumes: `XenonOAuthProvider`, `AuthCodes`, `GrantStore` (Task 5); `registerMcpEndpoint` (Task 1).
- Produces:
  - `publicOrigin(req): string` — `XENON_PUBLIC_URL`'s origin when set, else the request's scheme and host, forwarded ones only when `trustProxy` is set.
  - `mcpResourceUrl(req): string` = `publicOrigin(req) + '/xenon/mcp'`.
  - Routes: `GET /.well-known/oauth-protected-resource/xenon/mcp` and `/.well-known/oauth-protected-resource`; `GET /.well-known/oauth-authorization-server`; `POST /xenon/api/oauth/register`; `GET /xenon/api/oauth/authorize`; `GET /xenon/api/oauth/consent/:requestId` (the dashboard reads the pending request: client name, hub, scopes) and `POST /xenon/api/oauth/consent/:requestId` (`{ allow: boolean }`, cookie-authed, CSRF rules); `POST /xenon/api/oauth/token`; `POST /xenon/api/oauth/revoke`.
  - `authorize` redirects to `/xenon/oauth/consent/<requestId>` (the dashboard page, Task 8), after `/login?next=` when not signed in.

- [ ] **Step 1: Write the failing tests**

`oauth-flow.spec.ts`, end to end with the SDK's client auth helper (`auth()` from `@modelcontextprotocol/sdk/client/auth.js`) and a scripted consent POST as the signed-in user:
- `an agent signs in and calls xenon_lab_info` — registration, authorize, consent allow, token, `listTools()` with the access token.
- `the metadata names this hub on plain HTTP` — no throw for an `http://lab-mac:4723` issuer; `authorization_endpoint` under it.
- `deny redirects with error=access_denied`.
- `a wrong resource is refused` — `invalid_target`; `resource` with and without a trailing slash both accepted (Review Focus 4).
- `consent without the CSRF origin is refused 403`.
- `refresh gives a new pair and the old refresh token stops working`.

`mcp-public-origin.spec.ts`:
- `uses XENON_PUBLIC_URL when set`.
- `ignores X-Forwarded-Host and -Proto without trustProxy` and `uses them with trustProxy` (Review Focus 4).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx mocha test/integration/oauth-flow.spec.ts test/unit/mcp-public-origin.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Use the SDK's `authorizationHandler`, `tokenHandler`, `clientRegistrationHandler` and `revocationHandler` with `XenonOAuthProvider`, and build both metadata documents with `publicOrigin` (not `mcpAuthRouter`, whose issuer check refuses plain HTTP). Pending authorize requests live in memory for 10 minutes. Add every route to `identity.yaml`, then `npm run build:openapi`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx mocha test/integration/oauth-flow.spec.ts test/unit/mcp-public-origin.spec.ts test/unit/openapi-coverage.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/routers/oauth.ts src/mcp/publicOrigin.ts src/services/ServerManager.ts src/app/index.ts src/app/openapi website/openapi.json test/integration/oauth-flow.spec.ts test/unit/mcp-public-origin.spec.ts
git commit -m "feat(oauth): browser sign-in for agents: discovery, authorize, consent, token"
```

### Task 7: Revoking: grants API, `gid` everywhere, identity changes

**Files:**
- Modify: `src/middleware/verifyCredential.ts`, `src/services/identity/identityChanges.ts` listener registration (where the socket server's is), `src/app/routers/oauth.ts`, `src/app/openapi/identity.yaml`
- Test: `test/integration/oauth-revoke.spec.ts`

**Interfaces:**
- Consumes: `GrantStore` (Task 5), `LeaseService.endLeasesOfGrant` (Task 3).
- Produces:
  - `verifyBearerCredential` refuses a token whose `gid` names a revoked or missing grant, from `RevokedGrants` (a cache filled on read, cleared by `GrantStore.revoke`, 30 s for a grant found live).
  - `GET /xenon/api/oauth/grants` (own: `[{ id, clientName, scopes, createdAt, lastUsedAt }]`), `DELETE /xenon/api/oauth/grants/:id` (own, or any for an admin), `DELETE /xenon/api/oauth/grants?userId=` (admin: all of a user's).
  - On revoke: `endLeasesOfGrant(id, 'grant_revoked')`.
  - `onIdentityChanged` listener: a user now Inactive or deleted → `revokeAllOf(userId)`.

- [ ] **Step 1: Write the failing tests**

- `a revoked grant's access token is refused at once on /xenon/mcp, REST and per-command auth` — three calls, all refused right after `DELETE`.
- `a token without gid works as before`.
- `revoking ends the grant's leases` — lease row `endReason` `grant_revoked`.
- `a member can't revoke another user's grant` — `404` as an unknown id; an admin can.
- `setting a user Inactive revokes their grants and ends their agents' leases` (`revokeAllOf` revokes each grant through `revoke`, so each ends its leases).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx mocha test/integration/oauth-revoke.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**, then `npm run build:openapi`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx mocha test/integration/oauth-revoke.spec.ts test/unit/verifyCredential*.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/verifyCredential.ts src/services src/app test/integration/oauth-revoke.spec.ts website/openapi.json
git commit -m "feat(oauth): revoking an agent stops it at once and ends its leases"
```

### Task 8: Dashboard: consent and "AI agents"

**Files:**
- Create: `web/src/components/oauth/ConsentPage.tsx`, `web/src/components/agents/AgentsPage.tsx`, `web/src/components/agents/agentCommands.ts`
- Modify: `web/src/App.tsx` (routes `/oauth/consent/:requestId`, `/agents`), the sidebar's Testing group, `web/src/api-service/index.ts`
- Test: `web/src/components/oauth/ConsentPage.test.tsx`, `web/src/components/agents/AgentsPage.test.tsx`, `web/src/components/agents/agentCommands.test.ts`

**Interfaces:**
- Consumes: the consent and grants routes (Tasks 6, 7).
- Produces: `agentCommands(hubUrl: string, plainHttp: boolean): { client: string; label: string; command: string }[]` — per spec section 5's table; for a plain-HTTP hub, every agent's command runs the installer (`npx @xenon-device-management/mcp add --hub <url> --client <name>`), since those connect through the relay.

- [ ] **Step 1: Write the failing tests**

- `ConsentPage names the agent, the hub and each scope in plain words, and Allow posts allow: true`.
- `ConsentPage's Deny posts allow: false`.
- `AgentsPage shows one copyable command per agent with this hub's URL`.
- `AgentsPage lists my connected agents and Revoke calls DELETE /oauth/grants/:id`.
- `agentCommands gives Claude Code "claude mcp add --transport http xenon https://hub/xenon/mcp"` and the installer form for `http://lab-mac:4723`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && npx vitest run src/components/oauth src/components/agents`
Expected: FAIL.

- [ ] **Step 3: Implement** with the shared `Button`, `PageHeader` and role tokens; no new colour literals.

- [ ] **Step 4: Run them, the design ratchets and the type check**

Run: `cd web && npx vitest run src/components/oauth src/components/agents src/design && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(dashboard): agent sign-in consent and an AI agents page"
```

### Task 9: Documentation and the full run

**Files:**
- Modify: `website/docs/ai-agents.md`, `README.md`, `CLAUDE.md` (a "Xenon's MCP server" section: endpoint, `invokeApi`, sign-in, agent leases, revoking), `CHANGELOG.md` (Unreleased)

- [ ] **Step 1: Rewrite `ai-agents.md`**

Sections, per the spec: quick start with a tab per agent (the Task 8 commands); signing in and revoking; CI with an API credential; scopes; pairing with `appium-mcp` (`xenon_session_capabilities`, then create-session); a tool reference (name, scope, arguments, an example each); "One phone on your desk"; plain HTTP and what it exposes. Xenon Studio's note says the hub now serves MCP.

- [ ] **Step 2: README and CLAUDE.md sections; CHANGELOG entry**

- [ ] **Step 3: Run the whole suite and both builds**

Run: `export ANDROID_HOME=~/Library/Android/sdk && npm run test:all && npx tsc --noEmit && (cd web && npx vitest run && npx tsc --noEmit)`
Expected: all pass; no new skipped tests.

- [ ] **Step 4: Check by hand against a real hub**

Build (`npm run build:all`), start a scratch server with auth on (CLAUDE.md memory recipe: fake HOME, scratch SQLite), and add it to Claude Code (`claude mcp add --transport http xenon http://localhost:<port>/xenon/mcp`): sign in in the browser, run `xenon_lab_info` and `xenon_list_devices`, revoke on the AI agents page, see the next call refused.

- [ ] **Step 5: Commit**

```bash
git add website/docs/ai-agents.md README.md CLAUDE.md CHANGELOG.md
git commit -m "docs: Xenon's MCP server: install in any agent, sign in, tools"
```
