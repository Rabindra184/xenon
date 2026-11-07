/**
 * Which phone each member of a group lease gets.
 *
 * `candidates[i]` is the phone keys member `i` accepts, in the order it
 * prefers them. The answer gives each member a distinct key, or null, with
 * as many members given one as any assignment could (a maximum bipartite
 * matching, by augmenting paths: Kuhn's algorithm).
 *
 * `prefer[i]` is the key member `i` holds now. It is kept whenever a maximum
 * matching allows it, so a grant pass doesn't move holds for nothing:
 *
 * 1. Each member is seated on its preferred key first, when that key is
 *    among its candidates and no earlier member took it.
 * 2. Every member still without a key then looks for an augmenting path, in
 *    index order, trying keys in candidate order. It first looks for one
 *    that leaves every member on its preferred key where it is; only when
 *    there is none does it look again with those allowed to move. A path
 *    moves members to other keys but never leaves one without a key, so a
 *    preferred key is given up only to fill one more member.
 *
 * Pure: the inputs are not changed.
 */
export function maxMatching(candidates: string[][], prefer?: (string | null)[]): (string | null)[] {
  const match: (string | null)[] = candidates.map(() => null);
  const owner = new Map<string, number>();

  const seat = (member: number, key: string): void => {
    match[member] = key;
    owner.set(key, member);
  };

  candidates.forEach((keys, member) => {
    const wanted = prefer?.[member];
    if (wanted == null || owner.has(wanted) || !keys.includes(wanted)) return;
    seat(member, wanted);
  });

  // A member on its preferred key, which a first look leaves where it is.
  const onPreferredKey = (member: number): boolean =>
    prefer?.[member] != null && match[member] === prefer[member];

  // Kuhn's step: give `member` a key, moving others along the way.
  const augment = (member: number, visited: Set<string>, keepPreferred: boolean): boolean => {
    for (const key of candidates[member]) {
      if (visited.has(key)) continue;
      visited.add(key);
      const holder = owner.get(key);
      if (holder === undefined) {
        seat(member, key);
        return true;
      }
      if (keepPreferred && onPreferredKey(holder)) continue;
      if (augment(holder, visited, keepPreferred)) {
        seat(member, key);
        return true;
      }
    }
    return false;
  };

  candidates.forEach((_keys, member) => {
    if (match[member] !== null) return;
    if (augment(member, new Set(), true)) return;
    augment(member, new Set(), false);
  });

  return match;
}

/** How many members a match gave a key. */
export function filledCount(match: (string | null)[]): number {
  return match.filter((key) => key !== null).length;
}
