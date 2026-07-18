/**
 * Session-token capability gate (spec §3 Xenon item 6, risk R9).
 *
 * Appium's WebDriver port has no native auth. When XENON_REQUIRE_SESSION_TOKEN
 * is on, createSession must present EITHER a valid df:options access-key/token
 * pair (existing SDK path) OR a valid short-lived `xenon:options.sessionToken`
 * JWT (aud 'xenon-session', minted by POST /xenon/api/auth/token alongside
 * xenon-mcp tokens). Off by default — enabling is a deployment decision made
 * together with network-isolating the Appium port (hosted-mcp deploy doc).
 *
 * Node note: enforcement requires the signing key material (JwtKeyService).
 * Hub deployments have it; hub-node labs enable the flag on the hub, where
 * every developer-facing createSession lands first. Node-local enforcement
 * (JWKS-based verify without the private key) is a ledgered follow-up.
 */

export function sessionTokenGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(env.XENON_REQUIRE_SESSION_TOKEN ?? '');
}

export async function assertSessionTokenGate(opts: {
  enabled: boolean;
  hasValidKeyPair: boolean;
  token: string | null;
  verify: (token: string) => Promise<unknown>;
}): Promise<void> {
  if (!opts.enabled || opts.hasValidKeyPair) return;
  if (!opts.token) {
    throw new Error(
      'session rejected: XENON_REQUIRE_SESSION_TOKEN is enabled and neither ' +
        'df:options credentials nor a xenon:options.sessionToken capability were provided',
    );
  }
  try {
    await opts.verify(opts.token);
  } catch {
    throw new Error(
      'session rejected: xenon:options.sessionToken is invalid or expired ' +
        '(expected a hub-minted JWT with audience xenon-session)',
    );
  }
}
