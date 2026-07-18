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
  sessions: ['appium:use', 'xenon:recordings'],
  devices: ['xenon:devices:read', 'xenon:devices:lock', 'xenon:recordings'],
};

export const ALL_GRANULAR_SCOPES: readonly string[] = [
  ...new Set(Object.values(FLAT_TO_GRANULAR).flat()),
];

/** spec §7.1: least-scope default for day-to-day authoring. */
export const DEFAULT_MCP_SCOPES: readonly string[] = ['appium:use', 'xenon:devices:read'];

/**
 * Down-map: the minimal flat scope a granted granular scope needs so the same
 * token also works on the Xenon REST endpoints the MCP tools call. Only two
 * tools hit scope-gated REST endpoints:
 *   - appium:use       → 'sessions' (createSession authorizeSessionRequest requires it)
 *   - xenon:devices:lock → 'devices' (sdk-leases mutations are scopeGuard(['devices']))
 * xenon:devices:read / xenon:analytics:read / xenon:recordings hit role-gated-only
 * endpoints (roleGuard('MEMBER'), no scopeGuard — verified against grid.ts GET
 * /devices, dashboard healing reads, and recordings.ts), so they contribute NO
 * flat scope. Omitting them keeps the down-mapped flat set a strict subset of
 * the issuing key's own flat scopes — no cross-domain privilege escalation.
 */
const GRANULAR_TO_FLAT: Record<string, FlatScope> = {
  'appium:use': 'sessions',
  'xenon:devices:lock': 'devices',
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
  /** `['admin']` only for an admin key granted the FULL granular set. */
  roles: string[];
}

export function resolveMcpGrant(flatScopesCsv: string, requested?: string[]): McpGrant {
  const flatSet = new Set(
    flatScopesCsv
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is FlatScope => s === 'read' || s === 'sessions' || s === 'devices' || s === 'admin'),
  );

  const isAdminKey = flatSet.has('admin');
  const ceiling = new Set<string>(
    isAdminKey
      ? ALL_GRANULAR_SCOPES
      : [...flatSet].flatMap((f) => FLAT_TO_GRANULAR[f as Exclude<FlatScope, 'admin'>] ?? []),
  );

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

  const fullAdmin = isAdminKey && ALL_GRANULAR_SCOPES.every((s) => granular.includes(s));
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
