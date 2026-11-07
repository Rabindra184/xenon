---
title: AI agents (MCP)
description: "Give an AI agent in Cursor, VS Code or Claude a token for your Xenon lab: which token to make, what each MCP scope allows, how the agent starts sessions with it, and how to stop it."
---

An AI agent, such as the one in Cursor, VS Code or Claude, can test on your lab's phones. It does this through an **MCP server**: a program that gives the agent tools, such as "start a session", "tap" or "take a screenshot", and calls Xenon for it. This page covers what Xenon gives that server: a token that says who the agent acts for and what it may do.

:::note[Xenon Studio]
Xenon Studio, the MCP server and IDE extension made for Xenon, isn't publicly available yet. Until it is, any MCP server that can send a bearer token to Xenon's API, or a session token in a test session's capabilities, can use what this page describes.
:::

## How it fits together

```
Agent in your IDE ──MCP──▶ MCP server ──(xenon-mcp token)──▶ Xenon hub ──▶ the lab's phones
```

The MCP server holds the token, never the agent's chat. It sends the token in two ways:

- **To Xenon's API**, as `Authorization: Bearer <token>`: listing phones, leasing one, reading selector health, starting a recording.
- **To start a test session**, as `xe:options.sessionToken` in the session's capabilities. The session then belongs to the person the token was made for, so it gets their teams' phones, and they can watch and control the phone while it runs. See [Credentials in a test session](./authentication.md#credentials-in-a-test-session).

## Make a token

Ask for a token with the `xenon-mcp` audience, using your access key and token (or a dashboard sign-in):

```bash
curl -X POST http://localhost:4723/xenon/api/auth/token \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"audience":"xenon-mcp","scopes":["appium:use","xenon:devices:read"]}'
```

The answer has two tokens:

- `token`: the bearer token for the API.
- `sessionToken`: the token for test sessions. It comes only when the scopes include `appium:use` and your credential has the `sessions` or `admin` scope.

Both last 24 hours by default (`XENON_MCP_TOKEN_TTL_SEC`), and never longer than the credential they were made with.

## Choose the scopes

Give the agent only what it needs. Each MCP scope must be one your own credential allows, or the request is refused with `403 scope_exceeds_key`.

| MCP scope | Lets the agent | Your credential needs |
|---|---|---|
| `appium:use` | Start test sessions and drive the phone | `sessions` or `admin` |
| `xenon:devices:read` | List the lab's phones | `read`, `devices` or `admin` |
| `xenon:devices:lock` | Lease a phone and give it back ([Leases](./leases.md)) | `devices` or `admin` |
| `xenon:analytics:read` | Read [selector health](./selector-health.md) and heal history | `read` or `admin` |
| `xenon:recordings` | Start and stop [recordings](./recordings.md) | `sessions`, `devices` or `admin` |
| `xenon:execute` | Run Xenon's own commands on its session with `xenon_execute_script`: tap by text or icon, list and check what's on screen, wait settings, network mocks and the session's captured traffic, the session's name, status and tags | `sessions` or `admin` |

With no `scopes` in the request, the token gets `appium:use` and `xenon:devices:read`, as far as your credential allows them. `xenon:execute` is only given when asked for, and needs `appium:use` beside it: it works on a session the agent started. Its taps and screen checks send a screenshot to the lab's AI provider, and it can read what the session's network capture recorded, sign-in headers and cookies included, so give it only to an agent you would let see those. [Bearer tokens](./authentication.md#bearer-tokens) and [Roles and scopes](./roles-and-scopes.md) give the full rules.

A Member's own API tokens carry `sessions` and `read`, so a Member can make a token for sessions, phone lists and selector health, but not for leases. A Member signed in to the dashboard has `devices` too.

## Stop an agent

- **A token works until it expires.** Revoking the key or token it was made with doesn't stop it.
- **To stop it at once,** set the person to Inactive on the **Users** page. Xenon looks the person up on every request, so all their tokens stop working.
- **Shorter tokens** need less of that: set `XENON_MCP_TOKEN_TTL_SEC` on the hub, in seconds.

## Things to know

- **The first session on a phone is slower,** while the driver sets itself up on it. A real phone can take 30 to 90 seconds, longer than some MCP clients wait for a tool call by default. If the agent reports a timeout, raise the client's tool-call timeout to two or three minutes, and check the **Devices** page: the session may have started anyway.
- **What the agent does is on record like any test.** With `enableDashboard` on, its sessions appear on the **Sessions** page under the person the token was made for, with their commands, video and device logs.
- **An MCP server can report its tool calls** to `POST /xenon/api/audit/events`, with a key that has the `admin` scope. Xenon keeps them in its event log, unless `XENON_EVENT_LOG=off`.
- **A server tells clients what it supports** at `GET /xenon/api/capabilities`. `features.mcpScopedTokens` is `true` on a server that takes the MCP scopes above.
