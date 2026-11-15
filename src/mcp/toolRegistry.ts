import type { z } from 'zod';
import { config } from '../config';
import { mcpScopesAllowedBy } from '../services/token/mcpScopes';
import type { McpCaller } from './mcpCredential';
import { labInfoTool } from './tools/labInfo';

/** One tool `/xenon/mcp` serves. */
export interface XenonTool {
  name: string;
  /** The MCP scope the caller's token must grant; null for any signed-in caller. */
  scope: string | null;
  description: string;
  params: z.ZodType<unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
  run(args: unknown, caller: McpCaller): Promise<unknown>;
}

export function defineTool<A>(def: {
  name: string;
  scope: string | null;
  description: string;
  params: z.ZodType<A>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
  run(args: A, caller: McpCaller): Promise<unknown>;
}): XenonTool {
  return def as unknown as XenonTool;
}

/**
 * Every tool, in the order they are listed. A function, not a constant: the
 * tools' modules import defineTool from here, so the list is read only once
 * they have all loaded.
 */
function allTools(): XenonTool[] {
  return [labInfoTool];
}

/** Every tool's name, as `/capabilities` reports them. */
export function toolNames(): string[] {
  return allTools().map((t) => t.name);
}

/**
 * The MCP scopes a caller holds: a bearer token's own `scope` claim, else
 * what its flat scopes allow.
 */
export function mcpScopesOf(caller: McpCaller): string[] {
  return caller.mcpScopes ?? [...mcpScopesAllowedBy(caller.auth.scopes)].sort();
}

/** The tools this caller may see and call: every tool with auth disabled. */
export function toolsFor(caller: McpCaller): XenonTool[] {
  if (config.authDisabled === true) return allTools();
  const granted = new Set(mcpScopesOf(caller));
  return allTools().filter((t) => t.scope === null || granted.has(t.scope));
}
