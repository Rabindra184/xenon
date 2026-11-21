import { z } from 'zod';
import { mcpScopesAllowedBy } from '../services/token/mcpScopes';
import type { McpCaller } from './mcpCredential';

/**
 * One tool `/xenon/mcp` serves. Its own module, importing nothing of the
 * tools, the registry or `/capabilities`, so a tool can define itself without
 * loading the list it is part of.
 */
export interface XenonTool {
  name: string;
  /** The MCP scope the caller's token must grant; null for any signed-in caller. */
  scope: string | null;
  description: string;
  params: z.ZodType<unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
  run(args: unknown, caller: McpCaller): Promise<unknown>;
}

/**
 * `authToken`, which every tool accepts for prompts and skills written for
 * Xenon Studio's tools, and ignores: the caller is the one `/xenon/mcp`
 * signed in.
 */
export const AUTH_TOKEN_PARAM = z
  .string()
  .optional()
  .describe('Not used: you are already signed in. Leave it out.');

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
 * The MCP scopes a caller holds: a bearer token's own `scope` claim, else
 * what its flat scopes allow.
 */
export function mcpScopesOf(caller: McpCaller): string[] {
  return caller.mcpScopes ?? [...mcpScopesAllowedBy(caller.auth.scopes)].sort();
}
