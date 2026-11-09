import { Container } from 'typedi';
import { prisma } from '../../prisma';
import { HealEtalonService, LocatorSignature } from '../healing/HealEtalonService';
import { FINGERPRINT_IDENTITY_ATTRIBUTES, meaningful } from '../healing/fingerprintIdentity';
import { isResilioPath } from '../healing/resilioPath';
import { SessionScope, sessionScope, tupleWhere } from './selectorKeys';

/**
 * What this server has learnt about a selector, for a client that checks a
 * suite's locators are healable before they break (Xenon Test's ENH-14):
 * `GET /xenon/api/healing/fingerprint?strategy=&selector=`.
 *
 * It says whether a fingerprint exists, when it was learnt, the element's
 * type, whether Resilio has its path, and which identifying attributes it
 * holds, by name only: their values are the app's text (a label, a field's
 * hint), which this answer doesn't carry.
 *
 * Fingerprints are kept by selector text in this server's own database. On a
 * hub, a node's phones' fingerprints are in the node's, so the hub answers
 * for its own phones' selectors only.
 */
export interface FingerprintAnswer {
  strategy: string;
  selector: string;
  /** When it was first learnt; null when the store doesn't keep it. */
  learntAt: string | null;
  /** When it was last written (learnt again, or replaced by a heal). */
  updatedAt: string | null;
  /** The element's type: an Android class or an iOS element type. */
  type: string;
  /** Whether the Resilio tier has the element's path. */
  hasPath: boolean;
  /** Whether it says which element it is, which Fuzzy XML needs. */
  hasIdentity: boolean;
  /** The identifying attributes it holds, by name. */
  identityAttributes: string[];
}

export interface FingerprintQuery {
  strategy: string;
  selector: string;
}

const MAX_SELECTOR = 4_000;

export function parseFingerprintQuery(q: Record<string, unknown>): FingerprintQuery | null {
  const selector = typeof q.selector === 'string' ? q.selector : '';
  if (!selector || selector.length > MAX_SELECTOR) return null;
  const strategy = typeof q.strategy === 'string' ? q.strategy.slice(0, 200) : '';
  return { strategy, selector };
}

/**
 * Whether the caller may see a selector's fingerprint: an admin, or with
 * sign-in off, always; a member when a session they may see ran a find of it
 * (Selector Health's rule, access.ts, without its "healed": a fingerprint is
 * learnt from finds that worked). Finds are recorded with the dashboard on
 * only, so with it off a member sees none.
 */
export async function canSeeSelectorFinds(
  query: FingerprintQuery,
  scope: SessionScope,
): Promise<boolean> {
  if (!scope) return true;
  const row = await prisma.sessionLog.findFirst({
    where: { AND: [tupleWhere(query.strategy, query.selector), sessionScope(scope)] },
    select: { id: true },
  });
  return row !== null;
}

function isoOf(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value !== '') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/**
 * The answer, or null when there is no fingerprint for it, it was learnt
 * under another strategy, or the caller may not see it: alike, so the route
 * can't be used to learn which selectors exist.
 */
export async function readFingerprint(
  query: FingerprintQuery,
  scope: SessionScope,
  deps: {
    getSignature?: (selector: string) => Promise<LocatorSignature | null>;
    canSee?: typeof canSeeSelectorFinds;
  } = {},
): Promise<FingerprintAnswer | null> {
  const getSignature =
    deps.getSignature ??
    ((selector: string) => Container.get(HealEtalonService).getSignature(selector));
  const canSee = deps.canSee ?? canSeeSelectorFinds;
  if (!(await canSee(query, scope))) return null;
  const signature = (await getSignature(query.selector)) as
    | (LocatorSignature & { createdAt?: unknown; updatedAt?: unknown })
    | null;
  if (!signature) return null;
  if (query.strategy && signature.strategy && signature.strategy !== query.strategy) return null;
  const attributes = signature.attributes ?? {};
  const identityAttributes = FINGERPRINT_IDENTITY_ATTRIBUTES.filter((name) =>
    meaningful(attributes[name]),
  );
  return {
    strategy: signature.strategy ?? query.strategy,
    selector: signature.selector ?? query.selector,
    learntAt: isoOf(signature.createdAt),
    updatedAt: isoOf(signature.updatedAt) ?? isoOf(signature.lastSeen),
    type: signature.nodeName,
    hasPath: isResilioPath(signature.path),
    hasIdentity: identityAttributes.length > 0,
    identityAttributes: [...identityAttributes],
  };
}
