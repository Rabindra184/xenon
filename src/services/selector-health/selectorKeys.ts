import type { Prisma } from '../../generated/client';

/** One selector as the dashboard names it. A heal recorded with no strategy has strategy ''. */
export interface SelectorKey {
  strategy: string;
  selector: string;
}

/** The caller's sessions as a Session `where`; undefined for an admin, or with auth disabled. */
export type SessionScope = Prisma.SessionWhereInput | undefined;

/** One map key per selector; a heal with no strategy files under ''. */
export const keyOf = (strategy: string | null | undefined, selector: string): string =>
  `${strategy ?? ''}\u0000${selector}`;

/** Heal rows of one selector. Heals with no strategy match the empty one. */
export function tupleWhere(strategy: string, selector: string): Prisma.SessionLogWhereInput {
  return strategy
    ? { original_strategy: strategy, original_selector: selector }
    : {
        original_selector: selector,
        OR: [{ original_strategy: null }, { original_strategy: '' }],
      };
}

/** Heal rows in the caller's sessions, on one platform if given. */
export function sessionScope(
  scope: SessionScope,
  platform?: string | null,
): Prisma.SessionLogWhereInput {
  const parts: Prisma.SessionWhereInput[] = [];
  if (platform) parts.push({ device_platform: platform });
  if (scope) parts.push(scope);
  if (parts.length === 0) return {};
  return { session: { is: parts.length === 1 ? parts[0] : { AND: parts } } };
}

/** `items` in runs of at most `size`, so no `OR` list grows without bound. */
export function chunk<T>(items: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
