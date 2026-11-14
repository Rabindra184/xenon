import { meaningful, resourceIdName, sameText, stableIdentifierOf } from './fingerprintIdentity';

/** A fingerprint as the stores hold it: its type and the attributes it was saved with. */
export interface FingerprintElement {
  nodeName?: unknown;
  attributes?: Record<string, string> | null;
}

/** What an element reads, compared when neither side has an identifier. */
const READ_ATTRIBUTES = ['text', 'content-desc', 'label', 'name', 'hint', 'accessibility-id', 'id'];

const RECT = ['x', 'y', 'width', 'height'];

/**
 * Whether a fingerprint saved without a path is clearly the element whose
 * path is stored, so the store keeps that path (`saveSignature`, both
 * stores). Anything less drops it, and the next find that works learns it
 * again (a fingerprint without a path is relearnt, once per process).
 * Through 2.36 every save without a path kept the stored one, so a heal that
 * wrote another element's attributes left the old element's path: Resilio
 * then went by one element and Fuzzy XML by another.
 *
 * - The type must be the same.
 * - An identifier on either side decides (stableIdentifierOf): both must
 *   have one, of the same kind, naming the same element (a resource-id
 *   without its package, an iOS accessibility identifier exactly). A moved
 *   or reworded element keeps its path.
 * - With none on either, what they read: every text one of them has, the
 *   other has and reads the same (sameText), and at least one is shared.
 * - With no text either, the rect, all four values the same (a
 *   heal-written Android fingerprint has none: its rect is `bounds`).
 */
export function describesSameElement(
  stored: FingerprintElement,
  saved: FingerprintElement,
): boolean {
  if (String(stored.nodeName ?? '') !== String(saved.nodeName ?? '')) return false;
  const a = stored.attributes ?? {};
  const b = saved.attributes ?? {};

  const idA = stableIdentifierOf(a);
  const idB = stableIdentifierOf(b);
  if (idA || idB) {
    if (!idA || !idB || idA.attribute !== idB.attribute) return false;
    return idA.attribute === 'resource-id'
      ? resourceIdName(idA.value) === resourceIdName(idB.value)
      : idA.value === idB.value;
  }

  let shared = false;
  for (const name of READ_ATTRIBUTES) {
    const [va, vb] = [a[name], b[name]];
    const [hasA, hasB] = [meaningful(va), meaningful(vb)];
    if (!hasA && !hasB) continue;
    if (!hasA || !hasB || !sameText(va, vb)) return false;
    shared = true;
  }
  if (shared) return true;
  return RECT.every((name) => (a[name] ?? '') === (b[name] ?? ''));
}
