# Offline Agent Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a hub that can't reach the internet, a failed agent sign-in explains itself in the browser, and the next try registers and works, with no setting changed.

**Architecture:** A one-hour, in-memory fallback in `clientMetadataDocument.ts`. A network refusal of a document notes the time, and `clientDocumentsAccepted()` answers false until an hour has passed. Discovery and the store already read that function. A response wrapper on the authorize route turns an error JSON body into a small HTML page when the browser prefers HTML.

**Tech Stack:** TypeScript, Express 4 router (served under Appium's Express 5), `@modelcontextprotocol/sdk` 1.32 auth handlers, Mocha + Chai + Sinon + supertest.

**Spec:** `docs/superpowers/specs/2026-11-15-offline-agent-sign-in-design.md`

## Global Constraints

- **Window:** one hour (`CLIENT_DOCUMENT_FALLBACK_MS = 60 * 60_000`). Each network failure restarts it. It lives in memory: a restart begins with documents on.
- **What counts:** only reasons in the store's `NETWORK_REASONS` (`unresolvable`, `private_address`, `unreachable`, `timeout`) trip it.
- **One way only:** the fallback never turns documents on. `XENON_MCP_CLIENT_DOCUMENTS=off` still turns them off whatever the window says.
- **JSON stays as it is.** A request that doesn't prefer `text/html` gets exactly today's JSON, status and headers.
- **The page has no script and no link off the hub.** Its headers are `Cache-Control: no-store`, `X-Frame-Options: DENY`, and `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'`. Every inserted text is HTML-escaped.
- **Wording is for testers** (CLAUDE.md "Wording is for testers"): plain words and sentence case. Internal names appear only in the admin line, which needs the variable's exact name.
- **Specs must be hermetic** (CLAUDE.md "Testing"): a spec that trips the fallback resets it in its own `afterEach`, inside its `describe`.

## Review Focus

1. **An online hub given a bogus URL.** Anyone can name an unresolvable `client_id` URL. Expected: documents are off for an hour, agents register instead, and an agent that already signed in keeps working (its grant is in the database). Covered by Task 1's discovery test and the "registered client still works" test.
2. **A document refused for a non-network reason** (a 404, a bad document, a mismatched `client_id`). Expected: no fallback, since the hub can reach the internet. Task 1 test `does not fall back for a refusal that isn't about the network`.
3. **The switch set to `off` while the window is open, then unset.** Expected: off either way, and after the hour with the switch unset, documents are on again. Task 1 window tests.
4. **An error description with HTML in it** (from a query value echoed in an SDK error). Expected: shown as text, never markup. Task 2 test `escapes what it shows`.
5. **A browser on another authorize error** (bad PKCE, `too_many_requests` 429). Expected: a readable page with the same status, and `Retry-After` kept on the 429. Task 2 tests.

---

### Task 1: The one-hour fallback

**Files:**
- Modify: `src/services/oauth/clientMetadataDocument.ts` (the `clientDocumentsAccepted` block, lines ~395-411)
- Modify: `src/services/oauth/clientStore.ts:72-77` (export `NETWORK_REASONS`' message as a constant) and `documentClient` (~336-361)
- Test: `test/unit/oauth-client-metadata-document.spec.ts`, `test/unit/oauth-client-store.spec.ts`, `test/integration/oauth-flow.spec.ts`
- Docs: `website/docs/ai-agents.mdx` ("A lab on a closed network"), `website/docs/environment-variables.md` (the `XENON_MCP_CLIENT_DOCUMENTS` row)

**Interfaces:**
- Produces, in `clientMetadataDocument.ts`:
  - `export const CLIENT_DOCUMENT_FALLBACK_MS = 60 * 60_000;`
  - `export function clientDocumentsAccepted(now: number = Date.now()): boolean`: false when the switch is `off`, or when `now` is less than an hour after the last noted failure.
  - `export function noteUnreachableClientDocument(now: number = Date.now()): boolean`: records the failure; answers true when this opens a new window (documents were on until now), false when it only restarts one.
  - `export function resetClientDocumentFallback(): void`, for specs.
- Produces, in `clientStore.ts`: `export const DOCUMENT_UNREACHABLE = 'The client_id document could not be fetched';` (today's literal, now exported; Task 2 matches it).

- [ ] **Step 1: Write the failing window tests** in `oauth-client-metadata-document.spec.ts`, in a new `describe('falling back when documents can't be fetched')` with `afterEach(resetClientDocumentFallback)` and the env var saved and restored:
  - `it('is on until a network failure, then off for an hour')`: `t = 1_000_000`. Then `clientDocumentsAccepted(t)` is true; `noteUnreachableClientDocument(t)` is true; `clientDocumentsAccepted(t + 1)` is false; `clientDocumentsAccepted(t + CLIENT_DOCUMENT_FALLBACK_MS - 1)` is false; `clientDocumentsAccepted(t + CLIENT_DOCUMENT_FALLBACK_MS)` is true.
  - `it('restarts the hour on each failure, and says only the first opened it')`: `note(t)` is true. `note(t + 30 min)` is false. `accepted(t + 61 min)` is false; `accepted(t + 30 min + CLIENT_DOCUMENT_FALLBACK_MS)` is true.
  - `it('stays off while XENON_MCP_CLIENT_DOCUMENTS=off, whatever the window')`: with the env var `off` and no failure noted, `accepted(t)` is false. After `note(t)`, clearing the env var leaves `accepted(t + 1)` false and `accepted(t + CLIENT_DOCUMENT_FALLBACK_MS)` true.

- [ ] **Step 2: Run them, expect FAIL** (`noteUnreachableClientDocument` not exported).
Run: `npx mocha test/unit/oauth-client-metadata-document.spec.ts -g "falling back"`

- [ ] **Step 3: Implement** the three functions and the constant in `clientMetadataDocument.ts`. They use one module-level `let unreachableAt: number | undefined`. Extend `clientDocumentsAccepted`'s doc comment: the hub also falls back by itself for an hour after a network failure, and the env var makes it permanent.

- [ ] **Step 4: Run them, expect PASS**, plus the rest of the file.
Run: `npx mocha test/unit/oauth-client-metadata-document.spec.ts`

- [ ] **Step 5: Write the failing store tests** in `oauth-client-store.spec.ts`, inside `describe('a client named by a metadata document')`. Add `afterEach(resetClientDocumentFallback)` there.
  - `it('a network refusal turns documents off, and the next lookup is refused without a fetch')`: `fetchDocument` rejects with `ClientMetadataRefused('unresolvable', …)`. The first `getClient(url)` gives an `InvalidClientError` whose message equals `DOCUMENT_UNREACHABLE`. Then `clientDocumentsAccepted()` is false. A second `getClient(url)` gives the "This hub doesn't read client_id documents…" message, and `fetchDocument` was called once.
  - `it('does not fall back for a refusal that isn't about the network')`: for each of `status`, `invalid_document` and `client_id_mismatch`, the rejection leaves `clientDocumentsAccepted()` true.
  - `it('logs one warning when it falls back, naming the switch')`: stub the store's `log.warn` (`(store as any).log`). Two network refusals produce exactly one `warn` call, whose text contains `XENON_MCP_CLIENT_DOCUMENTS=off` and `an hour`.
  - `it('a registered client still works while documents are off')`: `registerClient(registration())`, then `noteUnreachableClientDocument()`. `getClient(id)` still answers the client.

- [ ] **Step 6: Run them, expect FAIL.**
Run: `npx mocha test/unit/oauth-client-store.spec.ts -g "metadata document"`

- [ ] **Step 7: Implement** in `ClientStore.documentClient`'s catch. When `NETWORK_REASONS.has(err.reason)`, call `noteUnreachableClientDocument()`. If it returns true, `this.log.warn("Couldn't fetch an agent's client_id document, so agents will register with the hub for an hour. On a network without internet access, set XENON_MCP_CLIENT_DOCUMENTS=off to make this permanent.")`. Replace the literal with `DOCUMENT_UNREACHABLE`.

- [ ] **Step 8: Run the two unit files, expect PASS.**
Run: `npx mocha test/unit/oauth-client-store.spec.ts test/unit/oauth-client-metadata-document.spec.ts`

- [ ] **Step 9: Write the failing discovery test** in `oauth-flow.spec.ts`, beside the existing `XENON_MCP_CLIENT_DOCUMENTS=off` test, with `resetClientDocumentFallback()` in a `finally`:
  - `it('a client_id document that cannot be fetched turns documents off in the metadata for an hour')`:
    - Stub `Container.get(ClientStore).fetchDocument` to reject with `ClientMetadataRefused('unreachable', 'x')`, restored in the `finally`.
    - `GET` authorize with `client_id=https://agent.example/client.json` and valid PKCE, `resource` and `redirect_uri=http://127.0.0.1:5000/cb`. Expect 400 and `body.error_description === DOCUMENT_UNREACHABLE`.
    - Then `GET /.well-known/oauth-authorization-server` gives `client_id_metadata_document_supported === false`.
    - Then an agent still registers and signs in through the spec's existing `agentAuth` helper.

- [ ] **Step 10: Run it, expect FAIL** without Step 7, then PASS with it.
Run: `npx mocha test/integration/oauth-flow.spec.ts -g "cannot be fetched"`

- [ ] **Step 11: Docs.** In `ai-agents.mdx`'s "A lab on a closed network", after the first sentences, add: when the hub can't fetch an agent's document, it stops offering documents for an hour, so the agent's next sign-in registers with the hub instead; setting `XENON_MCP_CLIENT_DOCUMENTS=off` makes that permanent, and skips the first failed sign-in. In `environment-variables.md`'s row, add: "Without it, the hub turns them off by itself for an hour after one can't be fetched."

- [ ] **Step 12: Commit**

```bash
git add src/services/oauth/clientMetadataDocument.ts src/services/oauth/clientStore.ts test/unit/oauth-client-metadata-document.spec.ts test/unit/oauth-client-store.spec.ts test/integration/oauth-flow.spec.ts website/docs/ai-agents.mdx website/docs/environment-variables.md
git commit -m "fix(oauth): a hub that can't fetch an agent's document falls back to registration for an hour"
```

### Task 2: A readable page for the sign-in's errors

**Files:**
- Create: `src/app/routers/oauthErrorPage.ts`
- Modify: `src/app/routers/oauth.ts:302-305` (mount the wrapper on `authorizeRoute`, before the limiter, so the 429s are covered)
- Test: `test/unit/oauth-error-page.spec.ts` (new), `test/integration/oauth-flow.spec.ts`
- Changelog: `CHANGELOG.md` (a new `## Unreleased` above `## 2.38.0`, `### Fixed`)

**Interfaces:**
- Consumes: `DOCUMENT_UNREACHABLE` from `clientStore.ts` (Task 1).
- Produces, in `oauthErrorPage.ts`:
  - `export function signInErrorPage(status: number, body: { error?: unknown; error_description?: unknown }): string`: the whole HTML document.
  - `export function readableErrorsForBrowsers(req: Request, res: Response, next: NextFunction): void`: middleware that wraps `res.json`. When `res.statusCode >= 400`, the body is an object with a string `error`, and `req.accepts(['json', 'html']) === 'html'`, it sends `signInErrorPage(...)` as `text/html; charset=utf-8` with the Global Constraints' headers. Otherwise it calls the original `res.json`. It keeps any header already set (`Retry-After`).

**Copy** (fixed by the spec; the page uses these exact strings):
- **Network case** (`error_description === DOCUMENT_UNREACHABLE`):
  - Title: "Xenon couldn't read this agent's details".
  - Body: "This hub couldn't reach the internet to read the agent's details. It now asks agents to register with it instead, so start the sign-in again from your agent."
  - Admin line: "For admins: on a network without internet access, set XENON_MCP_CLIENT_DOCUMENTS=off on the hub to make this permanent."
- **429:** title "Too many sign-ins right now", body the description, then "Wait a minute, then start the sign-in again from your agent."
- **Anything else:** title "This sign-in can't continue", body the description (or "The sign-in request wasn't valid." when there is none), then "Start the sign-in again from your agent."
- **Footer, small type:** `Error: <error> (<status>)`. The `<title>` is the page's title plus " · Xenon".

- [ ] **Step 1: Write the failing unit tests** in `test/unit/oauth-error-page.spec.ts`, mounting `readableErrorsForBrowsers` on a bare Express app whose handlers call `res.status(s).json(body)`; `request` from `test/helpers/loopbackRequest`:
  - `it('gives a browser the network page, with the switch for admins')`: body `{ error: 'invalid_client', error_description: DOCUMENT_UNREACHABLE }`, status 400, `Accept: text/html,application/xhtml+xml,*/*;q=0.8`. Expect status 400, a `text/html` content type, and text containing "start the sign-in again from your agent", `XENON_MCP_CLIENT_DOCUMENTS=off` and `Error: invalid_client (400)`. The headers are `no-store`, `DENY`, and a CSP containing `frame-ancestors 'none'`.
  - `it('leaves JSON to a client that asks for it, or says nothing')`: with `Accept: application/json`, and with no Accept, the body deep-equals the input JSON and the content type is JSON.
  - `it('escapes what it shows')`: `error_description: '<script>alert(1)</script>'`. The HTML has no `<script`, and contains `&lt;script&gt;`.
  - `it('keeps the status and Retry-After of a 429')`: the handler sets `Retry-After: 60`, then `429 { error: 'too_many_requests', error_description: 'x' }`. Expect 429, `retry-after` 60, and text containing "Too many sign-ins right now".
  - `it('passes a successful JSON answer through')`: 200 `{ ok: true }` with an HTML Accept stays JSON.
  - `it('has no script and links nowhere off the hub')`: for the three page kinds, the HTML matches neither `/<script/i` nor `/href="(?!\/)/`.

- [ ] **Step 2: Run, expect FAIL** (module missing).
Run: `npx mocha test/unit/oauth-error-page.spec.ts`

- [ ] **Step 3: Implement `oauthErrorPage.ts`.** A template string with inline CSS for light and dark (`prefers-color-scheme`) and an `escapeHtml` helper. No dashboard bundle: the page stands alone.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Mount it** in `oauth.ts`: `authorizeRoute.get('/', readableErrorsForBrowsers, limiter(LIMITS.authorize), refuseBadAuthorizeRequests, authorize);`. It covers `answerDirectly`, `refuseBadAuthorizeRequests` and the SDK handler's own `res.status(...).json(...)`.

- [ ] **Step 6: Write the failing flow test** in `oauth-flow.spec.ts`:
  - `it('a browser gets a readable page for an error answered directly')`: take the existing "no error before consent…" setup's `short challenge` variant with the browser Accept header. Expect 400, `text/html`, `Error: invalid_request (400)`, and no `location` header.
  - The existing direct-answer tests send no Accept, so they keep asserting JSON unchanged. Run them as the check.

- [ ] **Step 7: Run the flow spec, expect PASS.**
Run: `npx mocha test/integration/oauth-flow.spec.ts`

- [ ] **Step 8: Changelog.** Add `## Unreleased` above `## 2.38.0` with this summary line: "**Agents sign in on a hub that can't reach the internet, without a setting.**" Under `### Fixed`, two bullets in the house style:
  - The one-hour fallback, naming the reasons, the warning and the switch. Say that through 2.38 the sign-in showed bare JSON and the agent waited for ever.
  - The readable page for every authorize error in a browser, with JSON unchanged for other clients.

- [ ] **Step 9: Run the OAuth and MCP specs, lint the changed files, and check the types.**
Run: `npx mocha test/unit/oauth-*.spec.ts test/unit/mcp-*.spec.ts test/integration/oauth-*.spec.ts && npx tsc -p . --noEmit && npx eslint src/app/routers/oauthErrorPage.ts src/app/routers/oauth.ts src/services/oauth/clientMetadataDocument.ts src/services/oauth/clientStore.ts test/unit/oauth-error-page.spec.ts`
Expected: all passing. Compare ESLint's count with `origin/main`'s for the same files (no new problems).

- [ ] **Step 10: Commit**

```bash
git add src/app/routers/oauthErrorPage.ts src/app/routers/oauth.ts test/unit/oauth-error-page.spec.ts test/integration/oauth-flow.spec.ts CHANGELOG.md
git commit -m "fix(oauth): a browser gets a readable page for a sign-in error, not JSON"
```

### Task 3: Check against a hub with no internet

Not code: run by the session after Tasks 1 and 2, with a throwaway hub from this branch's build.

- [ ] **Step 1: Build and install.** Run `npm run build` in the worktree, then install it into the throwaway Appium home with `appium plugin install --source=local <worktree>`.
- [ ] **Step 2: Start the hub with no internet.** Use `node -r offline.cjs` (every name lookup fails but localhost's), with sign-in on and `XENON_MCP_CLIENT_DOCUMENTS` unset.
- [ ] **Step 3: First sign-in fails readably.** Claude Code: `claude mcp add`, then `claude mcp login xenon --no-browser` under the pty driver. The authorize URL opens the readable network page in the browser pane.
- [ ] **Step 4: Second sign-in works.** Run the login again: Claude Code registers (a generated `client_id`), signs in, and `claude -p` calls `xenon_lab_info`.
- [ ] **Step 5: Clean up.** Sign out on the AI agents page, remove the Claude Code entry, stop the hub, and delete the test password.
