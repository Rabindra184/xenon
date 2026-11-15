/**
 * Flat API-key scopes ↔ granular MCP-layer scope claims (spec §4.2).
 *
 * Xenon REST keeps enforcing the flat vocabulary unchanged; the granular
 * `xenon:*` names exist only inside JWT claims for the hosted MCP gateway's
 * per-tool authorization. This module is the single source of that mapping.
 */

export type FlatScope = 'read' | 'sessions' | 'devices' | 'admin';

/** Ceiling: what granular scopes each flat key scope may ever grant. */
const FLAT_TO_GRANULAR: Record<Exclude<FlatScope, 'admin'>, readonly string[]> = {
  read: ['xenon:devices:read', 'xenon:analytics:read'],
  // xenon:execute is the `xenon_execute_script` tool: Xenon's own `xe:` scripts
  // on a session the token started with appium:use, so only `sessions` allows it.
  // xenon:recordings is `devices`' alone: a recording of phones holds them, and
  // REST's recordingsScopeGuard takes `devices` for it (recordingsScope.ts).
  sessions: ['appium:use', 'xenon:execute'],
  devices: ['xenon:devices:read', 'xenon:devices:lock', 'xenon:recordings'],
};

export const ALL_GRANULAR_SCOPES: readonly string[] = [
  ...new Set(Object.values(FLAT_TO_GRANULAR).flat()),
];

/** spec §7.1: least-scope default for day-to-day authoring. */
export const DEFAULT_MCP_SCOPES: readonly string[] = ['appium:use', 'xenon:devices:read'];

/**
 * Down-map: the minimal flat scope a granted granular scope needs so the same
 * token also works on the Xenon REST endpoints the MCP tools call. Three tools
 * hit scope-gated REST endpoints:
 *   - appium:use         → 'sessions' (createSession authorizeSessionRequest requires it)
 *   - xenon:devices:lock → 'devices' (sdk-leases mutations are mutationScopeGuard(['devices']))
 *   - xenon:recordings   → 'devices' (a recording of phones, and every write on its
 *     group, takes `devices` in recordingsScopeGuard, recordingsScope.ts)
 * xenon:devices:read / xenon:analytics:read hit role-gated-only endpoints
 * (roleGuard('MEMBER'), no scope guard: grid.ts GET /devices, the dashboard's
 * healing reads), so they contribute NO flat scope. Nor does xenon:execute: its
 * tool calls no REST endpoint, only `executeScript` on a WebDriver session the
 * caller owns.
 *
 * Each down-mapped scope is granted (FLAT_TO_GRANULAR) only by the flat scope it
 * maps to, so for a key without `admin` the down-mapped flat set is a subset of
 * the key's own flat scopes: no cross-domain privilege escalation. An `admin` key
 * may grant every granular scope, so its narrowed token can carry `sessions` or
 * `devices`, which it doesn't hold by name; each is less than `admin`, which
 * passes every scope check (ApiKeyService.hasScope).
 */
const GRANULAR_TO_FLAT: Record<string, FlatScope> = {
  'appium:use': 'sessions',
  'xenon:devices:lock': 'devices',
  'xenon:recordings': 'devices',
};

export class McpScopeError extends Error {
  constructor(
    public readonly code: 'unknown_scope' | 'scope_exceeds_key',
    message: string,
  ) {
    super(message);
    this.name = 'McpScopeError';
  }
}

export interface McpGrant {
  /** Granular scopes for the JWT `scope` claim (space-joined by the caller). */
  granular: string[];
  /** Down-mapped flat scopes for the JWT `scopes` claim (comma-joined by the caller). */
  flat: string[];
  /**
   * `['admin']` only for an admin key granted the FULL granular set, and
   * never for a browser sign-in (`neverAdmin`).
   */
  roles: string[];
}

export interface McpGrantOptions {
  /**
   * An agent's browser sign-in (the OAuth provider's grantForRole): never
   * flat `admin` or `roles: ['admin']`, even for an admin granted every MCP
   * scope. An agent asks for every scope the hub lists (the SDK's client
   * does), and the consent page doesn't say "and admin", so an admin's agent
   * gets what a Member's does plus what its role grants by itself (every
   * team's phones), never a route that needs the `admin` scope or an
   * override of another user's session. POST /auth/token
   * keeps the full-admin rule: its caller asks for exactly what it names.
   */
  neverAdmin?: boolean;
}

function flatScopesOf(flatScopesCsv: string): Set<FlatScope> {
  return new Set(
    flatScopesCsv
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is FlatScope => s === 'read' || s === 'sessions' || s === 'devices' || s === 'admin'),
  );
}

/**
 * Every granular scope a credential with these flat scopes may hold: all of
 * them for `admin`. A key pair carries flat scopes only, so this is what it
 * grants an MCP caller.
 */
export function mcpScopesAllowedBy(flatScopesCsv: string): Set<string> {
  const flatSet = flatScopesOf(flatScopesCsv);
  return new Set<string>(
    flatSet.has('admin')
      ? ALL_GRANULAR_SCOPES
      : [...flatSet].flatMap((f) => FLAT_TO_GRANULAR[f as Exclude<FlatScope, 'admin'>] ?? []),
  );
}

export function resolveMcpGrant(
  flatScopesCsv: string,
  requested?: string[],
  opts: McpGrantOptions = {},
): McpGrant {
  const isAdminKey = flatScopesOf(flatScopesCsv).has('admin');
  const ceiling = mcpScopesAllowedBy(flatScopesCsv);

  let granular: string[];
  if (requested && requested.length > 0) {
    const unknown = requested.filter((s) => !ALL_GRANULAR_SCOPES.includes(s));
    if (unknown.length > 0) {
      throw new McpScopeError('unknown_scope', `unknown scope(s): ${unknown.join(', ')}`);
    }
    const exceeding = requested.filter((s) => !ceiling.has(s));
    if (exceeding.length > 0) {
      throw new McpScopeError(
        'scope_exceeds_key',
        `requested scope(s) exceed this key's grant: ${exceeding.join(', ')}`,
      );
    }
    granular = [...new Set(requested)].sort();
  } else {
    granular = DEFAULT_MCP_SCOPES.filter((s) => ceiling.has(s)).sort();
    if (granular.length === 0) {
      throw new McpScopeError(
        'scope_exceeds_key',
        'this key has no scopes grantable to an MCP token',
      );
    }
  }

  const fullAdmin =
    !opts.neverAdmin && isAdminKey && ALL_GRANULAR_SCOPES.every((s) => granular.includes(s));
  const flat = [
    ...new Set(
      granular.map((s) => GRANULAR_TO_FLAT[s]).filter((f): f is FlatScope => f !== undefined),
    ),
  ].sort();
  if (fullAdmin && !flat.includes('admin')) {
    flat.push('admin');
    flat.sort();
  }

  return { granular, flat, roles: fullAdmin ? ['admin'] : [] };
}
