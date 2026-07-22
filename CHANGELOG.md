# Changelog

All notable changes to `@xenon-device-management/xenon` (the Appium hub plugin).

This project follows [Semantic Versioning](https://semver.org/). Releases are
published to npm automatically when `package.json`'s `version` changes on `main`
(see `.github/workflows/npm-publish.yml`).

## 1.8.1

Patch release: two real-device iOS / session-lifecycle fixes found while
verifying the hosted-MCP lab path end-to-end on real Android and iOS hardware.

### Fixed

- **Real-device iOS sessions** — `injectWDAUrl` wrote the WebDriverAgent
  capabilities (`webDriverAgentUrl`, `usePreinstalledWDA`, `updatedWDABundleId`)
  into **both** the W3C `alwaysMatch` and `firstMatch[0]` objects. The spec
  forbids a capability appearing in both, so appium-xcuitest rejected every
  real-device iOS session with "property 'webDriverAgentUrl' should not exist on
  both primary and secondary object" — even though WebDriverAgent itself
  launched fine. The injected WDA caps are now written to exactly one bucket.
  (#160)
- **Device stuck `busy` after a thrown session create** — when the driver's
  `createSession` (or the remote forward) **threw**, the device allocated for
  the session was left stuck `busy: true` with no session, unavailable until the
  hub restarted: the throw skipped both `finalizeSession` and
  `handleSessionFailure` (the latter only unblocks when `createSession`
  *returns* an error object, not when it throws). The session-creation block now
  releases the device on any thrown error before rethrowing. (#161)

## 1.8.0

First release since 1.7.10, covering 11 merged PRs. The headline is **hosted-MCP
support**: everything Xenon Studio's lab mode needs (granular MCP scopes, session
tokens, audit ingest, MCP plugin endpoints) is now available from a published
version instead of only from `main`.

### Added

- **Hosted MCP support** — the `xenon-mcp` token audience is accepted on the REST
  bearer path so MCP plugin tool calls authenticate, plus the MCP plugin
  endpoints themselves. (#152, #153)
- **Granular MCP scopes** — flat→granular scope mapping with a least-scope
  default; `xenon-mcp` tokens carry granular `scope`/`roles` claims alongside a
  down-mapped flat `scopes` claim, so a token's REST reach never exceeds its MCP
  grant. (#153)
- **Session tokens (R9)** — `/auth/token` mints a short-lived `xenon-session`
  token alongside the `xenon-mcp` one, and `createSession` gained an opt-in
  `xenon:options.sessionToken` gate that closes the direct-to-Appium bypass.
  Off by default. (#153)
- **Capability flags** — `/capabilities` advertises `mcpScopedTokens` and
  `sessionTokenGate` so clients can detect support. (#153)
- **Audit ingest** — `POST /xenon/api/audit/events` feeds `EventLogService`
  (`mcp_audit` events), for gateway authz decisions. (#153)
- **Healing APIs** — `GET /healing/selector-health` (hotspots + etalon age), a
  `sessionId` filter on `GET /healing/events`, and an
  `xenon:options.healingTiers` tier-policy gate in `HealingOrchestrator`. (#152)
- **Socket bearer auth** — the Socket.IO handshake accepts a hub-issued bearer
  JWT as a dashboard principal. (#151)

### Fixed

- **iOS shared-stream device lock** — a manual stream lock (`manual_<actor>_<udid>`)
  no longer overwrites a live Appium session's `session_id`, which previously made
  session teardown fail to release the device (leaving it stuck `busy: true`) and
  caused the health monitor to skip reclamation. Session teardown now also stops an
  idle session-owned stream (when no one is watching) instead of letting it linger.
  (#157 — closes #149, #150)
- **Slow session creation** — the device-availability wait now polls every **1s**
  instead of 10s, so a create waiting on a briefly-busy device proceeds within ~1s
  of it freeing rather than quantizing into 10s chunks. (#155)
- **Lease port allocation** — hub node-pair credentials are wired into
  `LeaseService`'s port allocator. (#154)
- **Token minting** — `/auth/token` validates that `scopes` is an array before
  minting, returning a clean 400 instead of failing opaquely. (#153)
- **Recordings** — bearer principals can start recordings (`req.auth.userId`
  fallback). (#152)
- **mac-app hang diagnostics** — app shutdown is no longer reported as a GPU
  crash, and normal suspension no longer trips the hang detector. (#145, #148, #156)

### Changed

- **mac-app** — Electron 33 → 43. (#146)
- Added a load-guard test for the log batcher. (#147)

## 1.7.10 and earlier

Not tracked in this file — see the git history and PR list.
