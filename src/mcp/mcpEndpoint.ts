import express, { NextFunction, Request, Response, Router } from 'express';
import type { IncomingMessage } from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import log from '../logger';
import type { IPluginArgs } from '../interfaces/IPluginArgs';
import { McpCaller, resolveMcpCaller } from './mcpCredential';
import { toolsFor } from './toolRegistry';
import { runTool } from './toolCall';
import { publicOrigin, servesMcp } from './publicOrigin';
import pkg from '../../package.json';

const logger = log.scope('McpEndpoint');

/** Where an agent learns how to sign in to this endpoint (RFC 9728). */
const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/xenon/mcp';

/**
 * `/xenon/mcp`: the lab's tools for AI coding agents, over MCP Streamable
 * HTTP. Mounted on the `/xenon` router, beside `/api` and outside its login,
 * since that login takes the dashboard cookie and answers a 401 with no
 * challenge; this endpoint checks its own credentials (resolveMcpCaller).
 *
 * Stateless: each POST gets its own McpServer and transport with no MCP
 * session, so any process answers and a restart loses nothing. The answer is
 * JSON. Any other method answers 405: GET (a standing server stream), since
 * no tool sends server-initiated messages yet, and DELETE (ending a
 * session), since there is none.
 *
 * A node doesn't serve it: its phones are reached through its hub.
 */
export function registerMcpEndpoint(router: Router, pluginArgs: IPluginArgs): void {
  if (!servesMcp(pluginArgs)) return;
  router.all('/mcp', refuseOtherOrigins);
  router.post('/mcp', handlePost);
  router.all('/mcp', methodNotAllowed);
}

/**
 * A browser names the page that sent a request in `Origin`; an agent sends
 * none. A request from any page but this server's own is refused before its
 * credentials are read, as MCP's Streamable HTTP transport asks (against DNS
 * rebinding): with auth disabled no credential stands in the way, and a page
 * would otherwise call every tool.
 */
function refuseOtherOrigins(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin === undefined || sameOrigin(origin, publicOrigin(req))) return next();
  res.status(403).json({ error: 'forbidden_origin' });
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

async function handlePost(req: Request, res: Response): Promise<void> {
  const caller = await resolveMcpCaller(req);
  if (caller === 'unavailable') {
    res.status(503).json({ error: 'unavailable' });
    return;
  }
  if (caller === 'unauthenticated') {
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${publicOrigin(req)}${RESOURCE_METADATA_PATH}"`,
    );
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }

  const body = await parsedBody(req, res);
  if (body === PARSE_FAILED) {
    res.status(400).json(jsonRpcError(-32700, 'Parse error'));
    return;
  }

  const server = serverFor(caller);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  });
  try {
    await server.connect(transport);
    // The SDK reads `req.auth` as its own AuthInfo; nothing sets it here.
    await transport.handleRequest(req as unknown as IncomingMessage, res, body);
  } catch (err: any) {
    logger.error(`MCP request failed: ${err?.message ?? err}`);
    if (!res.headersSent) res.status(500).json(jsonRpcError(-32603, 'Internal server error'));
  }
}

/** An McpServer holding the tools this caller may use. */
function serverFor(caller: McpCaller): McpServer {
  const server = new McpServer({ name: 'xenon', version: String(pkg.version) });
  for (const tool of toolsFor(caller)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.params as any,
        annotations: tool.annotations,
      },
      ((args: unknown) => runTool(tool.name, caller, () => tool.run(args, caller))) as any,
    );
  }
  return server;
}

const PARSE_FAILED = Symbol('parse failed');

/**
 * The JSON body, parsed as the API router parses its own (express.json's
 * default limit). Appium may have parsed it already, or drained the stream.
 */
function parsedBody(req: Request, res: Response): Promise<unknown> {
  const already = (req as { body?: unknown }).body;
  if (already && typeof already === 'object' && Object.keys(already).length > 0) {
    return Promise.resolve(already);
  }
  if (!req.readable) return Promise.resolve(already);
  return new Promise((resolve) => {
    express.json()(req, res, (err?: unknown) =>
      resolve(err ? PARSE_FAILED : (req as { body?: unknown }).body),
    );
  });
}

function methodNotAllowed(_req: Request, res: Response): void {
  res.setHeader('Allow', 'POST');
  res.status(405).json(jsonRpcError(-32000, 'Method not allowed.'));
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}
