import { ISessionCapability } from '../../interfaces/ISessionCapability';
import { XE_OPTIONS, stringOption, xenonOptionsOf } from '../session/xenonOptions';

/**
 * Where a lease travels in a session's capabilities: `xe:options.leaseId`
 * names it, and `xe:options.leaseToken` proves the session holds it
 * (`xenon:options` is read as an alias; see xenonOptions.ts).
 *
 * The token is a bearer secret: whoever presents it may use the lease's
 * device. It is handed to the client once, in the lease-create response, so a
 * client that passes `appiumCapabilities` through unchanged proves it holds
 * the lease. It is never stored, and createSession takes it out of the caps
 * with the session's other credentials before anything else reads them
 * (sessionCredentials.ts).
 */
const LEASE_TOKEN = 'leaseToken';

/** The lease a session names, `xe:options.leaseId`. */
export function leaseIdOf(caps: ISessionCapability): string | undefined {
  return stringOption(xenonOptionsOf(caps), 'leaseId');
}

/**
 * The one answer to a session that may not use the lease it names, whether
 * the lease is gone, is someone else's, or is on a phone the caller can't
 * see. It names every condition without saying which one failed, so a caller
 * can't use it to learn about leases that aren't theirs.
 */
export function leaseRefusalMessage(leaseId: string): string {
  return (
    `lease ${leaseId} is not active, or this session did not prove it holds it — ` +
    'pass xe:options.leaseToken from the lease response, or create the session ' +
    'with the credentials that created the lease; and the phone must be one your teams can see'
  );
}

/** The capability bag for the lease-create response. Never persist the result. */
export function withLeaseToken(bag: Record<string, any>, token: string): Record<string, any> {
  return { ...bag, [XE_OPTIONS]: { ...(bag[XE_OPTIONS] ?? {}), [LEASE_TOKEN]: token } };
}
