import { Container } from 'typedi';
import { prisma } from '../../prisma';
import { HealEtalonService, PlatformSignature } from '../healing/HealEtalonService';
import { PlatformFamily } from '../healing/fingerprintKey';
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
 * Fingerprints are kept per platform (fingerprintKey.ts) in this server's own
 * database. The answer describes the one written most recently and names its
 * `platform`; `platforms` lists each platform's, newest first. On a hub, a
 * node's phones' fingerprints are in the node's, so the hub answers for its
 * own phones' selectors only.
 */
export interface FingerprintAnswer extends FingerprintDescription {
  /** Every platform's fingerprint of the selector, newest first; the first is the answer's. */
  platforms: FingerprintDescription[];
}

export interface FingerprintDescription {
  /**
   * The platform it is for: `android` or `ios`, or null for one stored
   * before 2.37 whose type doesn't say.
   */
  platform: PlatformFamily | null;
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
    listSignatures?: (selector: string, strategy: string) => Promise<PlatformSignature[]>;
    canSee?: typeof canSeeSelectorFinds;
  } = {},
): Promise<FingerprintAnswer | null> {
  const listSignatures =
    deps.listSignatures ??
    ((selector: string, strategy: string) =>
      Container.get(HealEtalonService).listSignatures(selector, strategy));
  const canSee = deps.canSee ?? canSeeSelectorFinds;
  if (!(await canSee(query, scope))) return null;
  const signatures = await listSignatures(query.selector, query.strategy);
  if (signatures.length === 0) return null;
  const platforms = signatures.map((signature) => describe(signature, query));
  return { ...platforms[0], platforms };
}

function describe(signature: PlatformSignature, query: FingerprintQuery): FingerprintDescription {
  const attributes = signature.attributes ?? {};
  const identityAttributes = FINGERPRINT_IDENTITY_ATTRIBUTES.filter((name) =>
    meaningful(attributes[name]),
  );
  return {
    platform: signature.platform,
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
