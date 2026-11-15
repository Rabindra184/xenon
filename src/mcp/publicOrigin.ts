import type { Request } from 'express';
import { Container } from 'typedi';
import { publicServerBase } from '../services/publicUrl';
import { PluginContext } from '../PluginContext';

/** Where this server's MCP endpoint is, under its origin. */
export const MCP_PATH = '/xenon/mcp';

/**
 * Whether this server serves `/xenon/mcp`: a hub or a standalone server
 * does, a node (one started with `hub`) doesn't, since its phones are
 * reached through its hub. registerMcpEndpoint and `/capabilities` both ask.
 */
export function servesMcp(pluginArgs: { hub?: unknown } | undefined): boolean {
  return pluginArgs?.hub === undefined;
}

/**
 * The origin agents reach this server at: XENON_PUBLIC_URL's when it is set
 * (publicServerBase), else the request's scheme and host.
 *
 * The request's are read as Express reads them, so a forwarded scheme or
 * host counts only when the app's `trust proxy` trusts the peer that sent it
 * (trustProxy.ts). The scheme is `req.protocol`. The host is Express 5's
 * `req.host`, which keeps the port: Express 4's `req.hostname` drops it, and
 * `http://lab-mac:4723` would become `http://lab-mac`. It is written out here
 * with the app's own trust function so it is the same on both.
 */
export function publicOrigin(req: Request): string {
  const configured = publicServerBase();
  if (configured) return configured;
  return `${req.protocol}://${requestHost(req)}`;
}

/**
 * Where a tool's URLs point: the origin the caller reached `/xenon/mcp` at,
 * else XENON_PUBLIC_URL's, else this server on loopback (a tool called with
 * no endpoint in between, as a spec calls one).
 */
export function callerOrigin(caller: { origin?: string }): string {
  return (
    caller.origin ?? publicServerBase() ?? `http://127.0.0.1:${Container.get(PluginContext).port}`
  );
}

/** This server's MCP endpoint, as an agent names it (the OAuth `resource`). */
export function mcpResourceUrl(req: Request): string {
  return publicOrigin(req) + MCP_PATH;
}

function requestHost(req: Request): string {
  const trust = req.app?.get('trust proxy fn') as
    | ((address: string | undefined, hop: number) => boolean)
    | undefined;
  let host = trust && trust(req.socket?.remoteAddress, 0) ? req.get('x-forwarded-host') : undefined;
  if (host && host.includes(',')) host = host.slice(0, host.indexOf(',')).trimEnd();
  return host || req.get('host') || 'localhost';
}
