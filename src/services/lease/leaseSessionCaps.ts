import { ISessionCapability } from '../../interfaces/ISessionCapability';

/**
 * Where the lease token travels in a session's capabilities.
 *
 * The token is a bearer secret: whoever presents it may use the lease's
 * device. It is handed to the client once, in the lease-create response, and
 * comes back as `xenon:options.leaseToken` so a client that passes
 * `appiumCapabilities` through unchanged proves it holds the lease. It is
 * never stored, and it must not reach the driver, the Session row or the
 * dashboard, which is why createSession takes it out of the caps before
 * anything else reads them.
 */
const XENON_OPTIONS = 'xenon:options';
const LEASE_TOKEN = 'leaseToken';

type Bucket = Record<string, any>;

const isObject = (v: unknown): v is Bucket => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The bucket whose `xenon:options` allocation reads the lease id from. It
 * merges `firstMatch[0]` then `alwaysMatch` with Object.assign, so an
 * alwaysMatch that has `xenon:options` at all wins outright.
 */
function leaseBucket(caps: ISessionCapability): Bucket | undefined {
  const always = caps?.alwaysMatch;
  if (isObject(always) && Object.prototype.hasOwnProperty.call(always, XENON_OPTIONS)) {
    return always;
  }
  const first = Array.isArray(caps?.firstMatch) ? caps.firstMatch[0] : undefined;
  return isObject(first) ? first : undefined;
}

/**
 * The lease a session names, `xenon:options.leaseId`, read from the same
 * bucket allocation reads it from.
 */
export function leaseIdOf(caps: ISessionCapability): string | undefined {
  const options = leaseBucket(caps)?.[XENON_OPTIONS];
  const id = isObject(options) ? options.leaseId : undefined;
  return typeof id === 'string' && id ? id : undefined;
}

/**
 * The one answer to a session that may not use the lease it names, whether
 * the lease is gone, is someone else's, or is on a phone the caller can't
 * see. It says how to prove you hold a lease without saying which case
 * applied, so a caller can't use it to learn about leases that aren't theirs.
 */
export function leaseRefusalMessage(leaseId: string): string {
  return (
    `lease ${leaseId} is not active, or this session did not prove it holds it — ` +
    'pass xenon:options.leaseToken from the lease response, or create the session ' +
    'with the credentials that created the lease'
  );
}

/** The capability bag for the lease-create response. Never persist the result. */
export function withLeaseToken(bag: Record<string, any>, token: string): Record<string, any> {
  return { ...bag, [XENON_OPTIONS]: { ...(bag[XENON_OPTIONS] ?? {}), [LEASE_TOKEN]: token } };
}

/**
 * Remove `xenon:options.leaseToken` from every capability bucket, in place,
 * and return the one the lease check should see: the token beside the lease
 * id. In place because Appium hands this same object to the driver.
 */
export function takeLeaseToken(caps: ISessionCapability): string | null {
  const options = leaseBucket(caps)?.[XENON_OPTIONS];
  const token =
    isObject(options) && typeof options[LEASE_TOKEN] === 'string' && options[LEASE_TOKEN]
      ? (options[LEASE_TOKEN] as string)
      : null;

  const buckets = [caps?.alwaysMatch, ...(Array.isArray(caps?.firstMatch) ? caps.firstMatch : [])];
  for (const bucket of buckets) {
    if (isObject(bucket) && isObject(bucket[XENON_OPTIONS])) {
      delete bucket[XENON_OPTIONS][LEASE_TOKEN];
    }
  }
  return token;
}

/**
 * A copy of `caps` with the token put back beside the lease id, for a peer
 * Xenon node: it re-runs createSession, lease check included, and takes the
 * token out again before its own driver sees it. `caps` is not modified.
 */
export function capsWithLeaseToken(
  caps: ISessionCapability,
  token: string | null,
): ISessionCapability {
  const bucket = leaseBucket(caps);
  if (!token || !bucket || !isObject(bucket[XENON_OPTIONS])) return caps;
  const withToken = {
    ...bucket,
    [XENON_OPTIONS]: { ...bucket[XENON_OPTIONS], [LEASE_TOKEN]: token },
  };
  if (bucket === caps.alwaysMatch) return { ...caps, alwaysMatch: withToken };
  const [, ...rest] = caps.firstMatch ?? [];
  return { ...caps, firstMatch: [withToken, ...rest] };
}
