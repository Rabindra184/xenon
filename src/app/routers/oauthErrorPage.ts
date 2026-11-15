import type { NextFunction, Request, Response } from 'express';
import { DOCUMENT_UNREACHABLE } from '../../services/oauth/clientStore';

/**
 * The sign-in's authorize page is opened by a person, in a browser, from
 * their agent. An error there used to reach them as bare JSON. A browser now
 * gets a short page saying what happened and what to do; any other client
 * (one that asks for JSON, or says nothing) gets the JSON it always got.
 *
 * The page stands alone: no script, no link off the hub (before consent the
 * hub sends a browser only to its own pages), no framing, nothing cached.
 */

const PAGE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
};

/** Text for element content (never an attribute: nothing inserted goes in one). */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface PageText {
  title: string;
  paragraphs: string[];
  forAdmins?: string;
}

type KnownAgent = 'claude-code' | 'codex';

/**
 * The agent a URL `client_id` names, for the steps the page gives. Only the
 * URL is read, never fetched. Claude Code saves its URL `client_id` before
 * the browser opens and goes back with it on a retry, whatever discovery
 * says, so it has to be signed out of the hub first; Codex reads discovery
 * again and registers (both checked on 2026-11-15).
 */
function knownAgentOf(clientId: string | undefined): KnownAgent | undefined {
  if (!clientId) return undefined;
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  if (url.host === 'claude.ai' && url.pathname.startsWith('/oauth/claude-code')) {
    return 'claude-code';
  }
  if (url.host === 'chatgpt.com' && url.pathname.startsWith('/oauth/codex')) return 'codex';
  return undefined;
}

const NEXT_STEP: Record<KnownAgent | 'other', string> = {
  'claude-code':
    'In Claude Code, cancel the waiting sign-in, then sign it out of this hub: run claude mcp logout xenon (with the name you gave the server), or open /mcp, choose the server and clear its authentication. Then sign in again: Claude Code now registers with the hub.',
  codex:
    'Cancel the waiting sign-in in Codex, then sign in again (codex mcp login xenon, with the name you gave the server): Codex now registers with the hub.',
  other:
    'Cancel the waiting sign-in in your agent and start it again. If it comes back to this page, sign the agent out of this hub first (its sign-out or clear-authentication command for MCP servers), then sign in again.',
};

function textFor(
  status: number,
  description: string | undefined,
  clientId: string | undefined,
): PageText {
  if (description === DOCUMENT_UNREACHABLE) {
    return {
      title: "Xenon couldn't read this agent's details",
      paragraphs: [
        "This hub couldn't fetch the agent's details from the internet, so it now asks agents to register with it instead.",
        NEXT_STEP[knownAgentOf(clientId) ?? 'other'],
      ],
      forAdmins:
        'For admins: on a network without internet access, set XENON_MCP_CLIENT_DOCUMENTS=off on the hub, so agents register from their first sign-in.',
    };
  }
  if (status === 429) {
    return {
      title: 'Too many sign-ins right now',
      paragraphs: [
        ...(description ? [description] : []),
        'Wait a minute, then start the sign-in again from your agent.',
      ],
    };
  }
  return {
    title: "This sign-in can't continue",
    paragraphs: [
      description || "The sign-in request wasn't valid.",
      'Start the sign-in again from your agent.',
    ],
  };
}

/** The whole page for an authorize error answered with `status` and an OAuth error body. */
export function signInErrorPage(
  status: number,
  body: { error?: unknown; error_description?: unknown },
  clientId?: string,
): string {
  const error = typeof body.error === 'string' ? body.error : 'error';
  const description =
    typeof body.error_description === 'string' ? body.error_description : undefined;
  const text = textFor(status, description, clientId);
  const paragraphs = text.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n    ');
  const admins = text.forAdmins ? `\n    <p class="admins">${escapeHtml(text.forAdmins)}</p>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(text.title)} · Xenon</title>
  <style>
    :root { color-scheme: light dark; --bg: #f6f7f9; --card: #ffffff; --text: #1a1d21; --muted: #5b6470; --border: #d5d9df; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #0d0f12; --card: #16191e; --text: #e8eaed; --muted: #9aa3ad; --border: #2a2f36; }
    }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); color: var(--text); font: 15px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; }
    main { max-width: 34rem; margin: 16px; padding: 28px 32px; background: var(--card); border: 1px solid var(--border); border-radius: 12px; }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 12px; }
    p { margin: 0 0 12px; }
    .admins { color: var(--muted); }
    .code { margin: 20px 0 0; color: var(--muted); font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(text.title)}</h1>
    ${paragraphs}${admins}
    <p class="code">Error: ${escapeHtml(error)} (${status})</p>
  </main>
</body>
</html>
`;
}

/**
 * Turns an error JSON answer into the page above for a browser. Wraps
 * `res.json`, so it covers every answer the authorize route gives: the
 * hub's own refusals and the SDK handler's. Headers already set
 * (`Retry-After`) are kept.
 */
export function readableErrorsForBrowsers(req: Request, res: Response, next: NextFunction): void {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    const isError =
      res.statusCode >= 400 &&
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { error?: unknown }).error === 'string';
    if (!isError || req.accepts(['json', 'html']) !== 'html') return json(body);
    for (const [name, value] of Object.entries(PAGE_HEADERS)) res.setHeader(name, value);
    res.type('html');
    const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : undefined;
    return res.send(signInErrorPage(res.statusCode, body as { error?: unknown }, clientId));
  }) as Response['json'];
  next();
}
