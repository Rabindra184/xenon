import _ from 'lodash';
import { ISessionCapability } from '../../interfaces/ISessionCapability';
import { SECRET_OPTION_FIELDS } from './sessionCredentials';
import { OPTION_NAMESPACES, isOptionsObject } from './xenonOptions';

/**
 * The capabilities a hub sends the node whose phone it allocated.
 *
 * Each instance has its own database, and the hub has already done what
 * needs its database: it checked the credentials, applied the team rule and
 * resolved the lease to a phone. The node gets a request that stands on its
 * own, whatever the node's auth settings: that one phone, and nothing the
 * node can't act on.
 *
 * - No credentials. createSession took them out of `caps` first thing; they
 *   are removed here again so no copy that leaves the hub can carry one. The
 *   node gets the hub's create token instead (hubSessionToken.ts).
 * - No lease id. The lease lives in the hub's database; a node that looked it
 *   up in its own would refuse the session.
 * - The phone, pinned: `appium:udid` in alwaysMatch, and no `appium:udid` or
 *   `appium:udids` anywhere else. A lease-bound allocation does not write the
 *   udid into the caps, and a `udids` list would let the node pick another
 *   phone than the one the hub holds.
 *
 * `caps` is not modified: the hub keeps its own copy for its records.
 */
const NOT_FOR_THE_NODE = ['leaseId', ...SECRET_OPTION_FIELDS] as const;
const DEVICE_PICKERS = ['appium:udid', 'appium:udids'] as const;

export function capsForNode(caps: ISessionCapability, udid: string): ISessionCapability {
  const alwaysMatch: Record<string, any> = isOptionsObject(caps?.alwaysMatch)
    ? _.cloneDeep(caps.alwaysMatch)
    : {};
  const firstMatch: Array<Record<string, any>> =
    Array.isArray(caps?.firstMatch) && caps.firstMatch.length > 0
      ? caps.firstMatch.map((entry) => (isOptionsObject(entry) ? _.cloneDeep(entry) : entry))
      : [{}];

  for (const bucket of [alwaysMatch, ...firstMatch]) {
    if (!isOptionsObject(bucket)) continue;
    for (const key of DEVICE_PICKERS) delete bucket[key];
    for (const namespace of OPTION_NAMESPACES) {
      const options = bucket[namespace];
      if (!isOptionsObject(options)) continue;
      for (const field of NOT_FOR_THE_NODE) delete options[field];
    }
  }
  alwaysMatch['appium:udid'] = udid;
  return { ...caps, alwaysMatch, firstMatch };
}
