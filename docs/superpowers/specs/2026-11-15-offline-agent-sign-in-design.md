# Agent sign-in on a hub that can't reach the internet

A small change to Xenon's MCP sign-in (`src/services/oauth/`,
`src/app/routers/oauth.ts`).

## Why

Claude Code and Codex name themselves by a URL (a client ID metadata
document) that the hub fetches from the internet. A lab on a closed network
that hasn't set `XENON_MCP_CLIENT_DOCUMENTS=off` sends their sign-in into a
dead end. Checked on 2026-11-15 against a hub whose name lookups all failed:

- The browser showed bare JSON:
  `{"error":"invalid_client","error_description":"The client_id document could not be fetched"}`.
- Claude Code waited for ever.
- Nothing pointed the admin at the switch, which only the docs' "A lab on a
  closed network" section explains.

With the switch off, both agents registered with the hub instead and signed
in. So the fix is to make the hub reach that state by itself, and to tell
the person in the browser what happened.

## Goals

- A sign-in that fails because the hub can't fetch an agent's document
  works when it's tried again, with no setting changed.
- The person in the browser reads what happened and what to do, not JSON.

## Non-goals

- Probing the internet from the hub, or guessing whether it is online in
  any other way.
- Changing how documents are fetched, checked or cached.
- Changing what a client that asks for JSON gets.

## Anti-goals

- A failure must never stop a sign-in that would otherwise work: falling
  back to registration is always safe, so the fallback only ever turns
  documents off, never on.
- The page must not become a way to redirect a browser off the hub (RFC
  9700 §4.11.2). It links nowhere but the hub's own docs and has no
  automatic redirect.

## Approaches

1. **Fall back by itself, and show a readable page** (chosen). A fetch that
   fails for a network reason turns document support off for a while.
   Discovery then says so, and the agent's next sign-in registers. Every
   refusal on the authorize page becomes readable HTML for a browser.
2. **Only a readable page.** It names the switch, and an admin sets it and
   restarts. It's simpler, but the sign-in stays broken until someone with
   access to the hub's configuration acts.
3. **Probe the internet at start.** The hub tries a known host and turns
   documents off when it can't reach it. It needs a host to trust, slows
   the start, is wrong behind a proxy that lets some hosts through, and
   misses a lab that loses its connection later. Rejected.

## Design

- **Fallback.** In `clientMetadataDocument.ts`:
  - **What trips it:** a fetch refused for a reason in `NETWORK_REASONS`
    (`unresolvable`, `private_address`, `unreachable`, `timeout`) notes
    the time.
  - **What it changes:** discovery's `client_id_metadata_document_supported`
    reads a new `clientDocumentsOffered()`. It answers false for one hour
    after the last such failure, and while `XENON_MCP_CLIENT_DOCUMENTS=off`
    is set.
  - **Timing:** each further network failure restarts the hour. Nothing
    else resets it, and it is in memory, so a restart offers documents
    again.
  - **What it doesn't change:** whether the hub reads a URL `client_id`.
    That stays `clientDocumentsAccepted()`, the switch alone. The store's
    path also serves refresh, and the fallback can be tripped by anyone, so
    turning reading off would have signed out every agent named by a
    document for an hour. *(Changed while building: the first version had
    the store follow the fallback too.)*
  - **What it logs:** the first failure in a window logs one warning,
    saying documents are off for an hour and that
    `XENON_MCP_CLIENT_DOCUMENTS=off` makes it permanent.
- **Readable page.** On the authorize route, an error answer goes out as a
  short HTML page when the request prefers `text/html` (a browser's
  navigation), and as the same JSON as today otherwise. This covers the
  SDK's own answers (unknown client, bad redirect URI) and `answerDirectly`'s.
  - **What's on it:** the status code, a title, a sentence or two in plain
    words, and the OAuth `error` code in small type for anyone reporting
    it. It carries no scripts and no links off the hub.
  - **The network failure says:** "This hub couldn't reach the internet to
    read the agent's details. It now asks agents to register with it
    instead, so start the sign-in again from your agent." A line for
    admins names `XENON_MCP_CLIENT_DOCUMENTS=off`, which makes this
    permanent.
  - **The other errors** get their existing `error_description` under a
    generic title.
  - **Security headers:** `Cache-Control: no-store`, and the
    `frame-ancestors 'none'` / `X-Frame-Options: DENY` the dashboard pages
    have.
- **Docs.** The "A lab on a closed network" section of
  `website/docs/ai-agents.mdx` and `environment-variables.md` say the hub
  falls back by itself for an hour after a failed fetch, and that the
  setting makes it permanent. The CHANGELOG gets an Unreleased entry.

## Risk

Anyone who can reach the authorize page can trip the fallback, by naming a
URL `client_id` that doesn't resolve. For an hour, discovery then tells new
agents to register with the hub. That always works, but it uses
registration slots: 20 per address an hour and 500 in all, the least-used
evicted. An agent already signed in by a document keeps refreshing, because
the hub still reads documents during the fallback.

## Left to the builder

- How the page is rendered (a small template string, escaped).
- How a browser's request is told apart (`req.accepts(['json', 'html'])`
  or equivalent).
- The exact test seams: the clock, and the fetch's existing `MetadataFetchDeps`.

## Checked when done

- The unit specs for the fallback window, discovery and the page.
- The no-internet hub of 2026-11-15 again (a preload that fails every name
  lookup): the first Claude Code sign-in shows the readable page, and the
  second registers and signs in.
