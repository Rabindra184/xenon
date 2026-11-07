/**
 * Which phone each member of a group lease gets.
 *
 * `candidates[i]` is the phone keys member `i` accepts, in the order it
 * prefers them. The answer gives each member a distinct key, or null, with
 * as many members given one as any assignment could (a maximum bipartite
 * matching, by augmenting paths: Kuhn's algorithm).
 *
 * `prefer[i]` is the key member `i` holds now. Among the maximum matchings,
 * the answer keeps as many members on their preferred keys as any of them
 * does, so a grant pass never moves a hold it could have left alone. When
 * several sets of members could keep theirs, the set that comes first by
 * member index keeps them ({0, 2} before {1, 2}).
 *
 * How it is found, exactly (a group has at most 8 members):
 *
 * 1. The maximum count, by plain Kuhn with nothing locked.
 * 2. The members that could keep a key: those whose preferred key is among
 *    their candidates.
 * 3. Sets of those members, largest first, ties in member-index order. A set
 *    is tried by locking it: each of its members is seated on its preferred
 *    key, and for the rest of that try the key is its own. No augmenting
 *    path may take the key or move the member to another. Kuhn then seats
 *    the other members around the locked ones. The first set whose try still
 *    reaches the maximum count is the answer. A set in which two members
 *    prefer the same key is never tried, since only one could keep it.
 *
 * At most 2^8 tries, each at Kuhn's own cost. The empty set always reaches
 * the maximum, so there is always an answer.
 *
 * Pure: the inputs are not changed.
 */
export function maxMatching(candidates: string[][], prefer?: (string | null)[]): (string | null)[] {
  const unlocked = kuhn(candidates, []);
  const best = filledCount(unlocked);

  const keepers: [number, string][] = [];
  candidates.forEach((keys, member) => {
    const wanted = prefer?.[member];
    if (wanted != null && keys.includes(wanted)) keepers.push([member, wanted]);
  });

  for (let size = keepers.length; size > 0; size--) {
    for (const locked of subsetsInIndexOrder(keepers, size)) {
      if (new Set(locked.map(([, key]) => key)).size !== size) continue;
      const match = kuhn(candidates, locked);
      if (filledCount(match) === best) return match;
    }
  }
  return unlocked;
}

/** How many members a match gave a key. */
export function filledCount(match: (string | null)[]): number {
  return match.filter((key) => key !== null).length;
}

/**
 * Kuhn's algorithm with some members locked on keys: a locked member keeps
 * its key, and no augmenting path takes it. The others are seated in index
 * order, each trying keys in candidate order.
 */
function kuhn(candidates: string[][], locked: [number, string][]): (string | null)[] {
  const match: (string | null)[] = candidates.map(() => null);
  const owner = new Map<string, number>();
  const isLocked = new Set<number>();

  const seat = (member: number, key: string): void => {
    match[member] = key;
    owner.set(key, member);
  };

  for (const [member, key] of locked) {
    seat(member, key);
    isLocked.add(member);
  }

  const augment = (member: number, visited: Set<string>): boolean => {
    for (const key of candidates[member]) {
      if (visited.has(key)) continue;
      visited.add(key);
      const holder = owner.get(key);
      if (holder === undefined) {
        seat(member, key);
        return true;
      }
      if (isLocked.has(holder)) continue;
      if (augment(holder, visited)) {
        seat(member, key);
        return true;
      }
    }
    return false;
  };

  candidates.forEach((_keys, member) => {
    if (!isLocked.has(member)) augment(member, new Set());
  });
  return match;
}

/** Every `size`-item subset of `items`, in index order: {0, 1}, {0, 2}, {1, 2}. */
function subsetsInIndexOrder<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const pick: T[] = [];
  const walk = (start: number): void => {
    if (pick.length === size) {
      out.push([...pick]);
      return;
    }
    for (let i = start; i <= items.length - (size - pick.length); i++) {
      pick.push(items[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return out;
}
