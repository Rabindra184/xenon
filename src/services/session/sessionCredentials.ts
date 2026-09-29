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
 * stays: a lease id is not a secret. They never leave the server they were
 * sent to.
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
 * if need be, with the options that are not secrets.
 *
 * Nothing puts the credentials back. A hub forwarding a create to a node
 * sends the hub's own create token instead (gateway/hubSessionToken.ts): each
 * instance has its own database, so the node could not check them anyway.
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
