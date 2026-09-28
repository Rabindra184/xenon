import { ISessionCapability } from '../../interfaces/ISessionCapability';
import { extractAccessKeyTokenPair, extractSessionToken } from '../../XenonCapabilityManager';
import { OPTION_NAMESPACES, isOptionsObject, stringOption, xenonOptionsOf } from './xenonOptions';

/**
 * The credentials a session presents, and where they may go.
 *
 * Each is a bearer secret. `accessKey` + `token` and `sessionToken` say who
 * the caller is; `leaseToken` lets whoever holds it use the lease's device.
 * They arrive in `xe:options` (or the `xenon:options` alias). createSession
 * reads them once, with `takeSessionCredentials`, and that same call takes
 * them out of the capabilities, in place, before anything else reads them:
 * the pending-session row, device allocation, the driver, the Session row,
 * the dashboard and the logs. Every other option, the lease id included,
 * stays: a lease id is not a secret.
 */
export const SECRET_OPTION_FIELDS = ['accessKey', 'token', 'sessionToken', 'leaseToken'] as const;

export interface SessionCredentials {
  /** `accessKey` + `token`, when both are present. Not yet verified. */
  pair: { accessKey: string; token: string } | undefined;
  /** `sessionToken`: a hub-minted JWT, audience `xenon-session`. Not yet verified. */
  sessionToken: string | null;
  /**
   * `leaseToken`, read beside the lease id: from the same merged view, so a
   * token in firstMatch while alwaysMatch carries the options is stripped but
   * not honoured.
   */
  leaseToken: string | null;
}

type Bucket = Record<string, any>;

function buckets(caps: ISessionCapability | undefined): Bucket[] {
  const firstMatch = caps?.firstMatch;
  const all = [caps?.alwaysMatch, ...(Array.isArray(firstMatch) ? firstMatch : [])];
  return all.filter(isOptionsObject);
}

/**
 * Read the session's credentials, then remove every secret field from both
 * namespaces in alwaysMatch and every firstMatch entry, in place: Appium hands
 * this same object to the driver. The namespaces themselves are kept, emptied
 * if need be, so a peer node's copy can put the credentials back where they
 * came from (see capsWithCredentials).
 */
export function takeSessionCredentials(caps: ISessionCapability): SessionCredentials {
  const credentials: SessionCredentials = {
    pair: extractAccessKeyTokenPair(caps),
    sessionToken: extractSessionToken(caps),
    leaseToken: stringOption(xenonOptionsOf(caps), 'leaseToken') ?? null,
  };
  for (const bucket of buckets(caps)) {
    for (const namespace of OPTION_NAMESPACES) {
      const options = bucket[namespace];
      if (!isOptionsObject(options)) continue;
      for (const field of SECRET_OPTION_FIELDS) delete options[field];
    }
  }
  return credentials;
}

/** The secret fields to put back, from what was read. */
function secretFields(credentials: SessionCredentials): Bucket {
  const fields: Bucket = {};
  if (credentials.pair) {
    fields.accessKey = credentials.pair.accessKey;
    fields.token = credentials.pair.token;
  }
  if (credentials.sessionToken) fields.sessionToken = credentials.sessionToken;
  if (credentials.leaseToken) fields.leaseToken = credentials.leaseToken;
  return fields;
}

/**
 * Where the winning namespace lives in the merged view: the bucket (the one
 * that holds it, alwaysMatch first) and the namespace itself.
 */
function home(caps: ISessionCapability): { bucket: Bucket; namespace: string } | undefined {
  const always = caps?.alwaysMatch;
  const first = Array.isArray(caps?.firstMatch) ? caps.firstMatch[0] : undefined;
  for (const namespace of OPTION_NAMESPACES) {
    for (const bucket of [always, first]) {
      if (!isOptionsObject(bucket) || !Object.prototype.hasOwnProperty.call(bucket, namespace)) {
        continue;
      }
      // alwaysMatch holding the key hides firstMatch's, as in the merged view.
      if (isOptionsObject(bucket[namespace])) return { bucket, namespace };
      break;
    }
  }
  return undefined;
}

/**
 * A copy of `caps` with the credentials put back, for a peer Xenon node. The
 * node re-runs createSession: it authenticates and attributes the session,
 * enforces XENON_REQUIRE_SESSION_TOKEN and checks the lease itself, so it
 * needs exactly what this hub read. It takes them out again before its own
 * driver sees them. They go into the namespace that wins, so the node reads
 * the same values. `caps` is not modified. Never hand this to a cloud
 * provider: it is not a Xenon node.
 */
export function capsWithCredentials(
  caps: ISessionCapability,
  credentials: SessionCredentials,
): ISessionCapability {
  const fields = secretFields(credentials);
  const target = home(caps);
  if (Object.keys(fields).length === 0 || !target) return caps;

  const { bucket, namespace } = target;
  const withCredentials = { ...bucket, [namespace]: { ...bucket[namespace], ...fields } };
  if (bucket === caps.alwaysMatch) return { ...caps, alwaysMatch: withCredentials };
  const [, ...rest] = caps.firstMatch ?? [];
  return { ...caps, firstMatch: [withCredentials, ...rest] };
}
