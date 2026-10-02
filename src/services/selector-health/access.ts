import { prisma } from '../../prisma';
import { SelectorKey, SessionScope, chunk, keyOf, sessionScope, tupleWhere } from './selectorKeys';

/** The answer for a selector the caller may not see, the same as for one that doesn't exist. */
export const SELECTOR_NOT_FOUND = { error: 'not_found', message: 'Selector not found' };

/**
 * The keys among `keys` the caller may see: those healed, at any time, in a
 * session the caller may see. All of them for an admin or with auth disabled.
 */
export async function visibleKeys(keys: SelectorKey[], scope: SessionScope): Promise<Set<string>> {
  if (!scope) return new Set(keys.map((k) => keyOf(k.strategy, k.selector)));
  const seen = new Set<string>();
  for (const part of chunk(keys)) {
    const groups = await prisma.sessionLog.groupBy({
      by: ['original_strategy', 'original_selector'],
      where: {
        AND: [
          { is_healed: true },
          sessionScope(scope),
          { OR: part.map((k) => tupleWhere(k.strategy, k.selector)) },
        ],
      },
    });
    for (const g of groups) {
      if (g.original_selector) seen.add(keyOf(g.original_strategy, g.original_selector));
    }
  }
  return seen;
}

/** Whether the caller may see one selector, by the same rule. */
export async function canSeeSelector(key: SelectorKey, scope: SessionScope): Promise<boolean> {
  if (!scope) return true;
  const row = await prisma.sessionLog.findFirst({
    where: {
      AND: [{ is_healed: true }, tupleWhere(key.strategy, key.selector), sessionScope(scope)],
    },
    select: { id: true },
  });
  return row !== null;
}

/** Mark fixed, mute, unmute and cancel need the `sessions` scope; `admin` has every scope. */
export function canActOnSelectors(scopes: string | string[] | undefined): boolean {
  const owned = new Set(
    (Array.isArray(scopes) ? scopes : (scopes ?? '').split(',')).map((s) => s.trim()),
  );
  return owned.has('admin') || owned.has('sessions');
}
