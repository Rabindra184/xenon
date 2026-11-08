/**
 * A lease of another server's (a node's) phone reserves its driver ports on
 * that server, with this server's node credentials. This server's own phones
 * need none (services/ports/ownPorts.ts).
 */

/** Why a lease can't take another server's phone here. */
export const NODE_CREDENTIALS_MISSING =
  "leases can't take another server's phone here: this server can't sign tokens for its " +
  "nodes (its JWT key didn't load) and has no XENON_HUB_ACCESS_KEY and XENON_HUB_TOKEN " +
  '(an Admin key with the devices scope)';

/** Whether this server holds what it needs to reserve ports on another server. */
export function nodeCredentialsReady(cfg: {
  hubAccessKey?: string;
  hubToken?: string;
  authDisabled: boolean;
}): boolean {
  return cfg.authDisabled || (!!cfg.hubAccessKey && !!cfg.hubToken);
}

/**
 * Whether leases can take another server's phone: with a hub ports token
 * (the hub can sign, which it can whenever its JWT key loaded at boot), or the
 * node-pair credentials, or with sign-in off. A node older than this release
 * with sign-in on takes only the pair, which it can't check: such a lease
 * still fails there.
 */
export function nodePhonesLeasable(
  cfg: { hubAccessKey?: string; hubToken?: string; authDisabled: boolean },
  canSign: boolean,
): boolean {
  return canSign || nodeCredentialsReady(cfg);
}
