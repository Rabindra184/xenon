/**
 * A lease of another server's (a node's) phone reserves its driver ports on
 * that server, with this server's node credentials. This server's own phones
 * need none (services/ports/ownPorts.ts).
 */

/** Why a lease can't take another server's phone here. */
export const NODE_CREDENTIALS_MISSING =
  "leases can't take another server's phone here: set XENON_HUB_ACCESS_KEY and " +
  'XENON_HUB_TOKEN (an Admin key with the devices scope) on this server';

/** Whether this server holds what it needs to reserve ports on another server. */
export function nodeCredentialsReady(cfg: {
  hubAccessKey?: string;
  hubToken?: string;
  authDisabled: boolean;
}): boolean {
  return cfg.authDisabled || (!!cfg.hubAccessKey && !!cfg.hubToken);
}
