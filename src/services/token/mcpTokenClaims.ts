import type { McpGrant } from './mcpScopes';

/**
 * The claims of a `xenon-mcp` access token, wherever it is minted: POST
 * /auth/token (`issueToken`) and an agent's browser sign-in
 * (`XenonOAuthProvider`). One function, so both kinds stay the same token,
 * which REST, per-command auth and `/xenon/mcp` already take.
 *
 * - `scope`: the granular MCP scopes, space-separated.
 * - `scopes`: the flat scopes they down-map to (comma-separated), so the
 *   token's REST power matches its MCP grant.
 * - `roles`: `['admin']` only for an admin credential granted every MCP
 *   scope by POST /auth/token; never for a browser sign-in.
 * - `gid`: the sign-in grant it was issued under, when there is one. A token
 *   POST /auth/token mints has none.
 *
 * Claims only: the caller signs them, with its own lifetime.
 */
export function mcpTokenClaims(
  auth: { userId: string; role: string; teamId?: string | null },
  grant: McpGrant,
  opts: { grantId?: string } = {},
): Record<string, unknown> {
  return {
    sub: auth.userId,
    role: auth.role,
    scopes: grant.flat.join(','),
    teamId: auth.teamId ?? null,
    scope: grant.granular.join(' '),
    roles: grant.roles,
    ...(opts.grantId ? { gid: opts.grantId } : {}),
  };
}
