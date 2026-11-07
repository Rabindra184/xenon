import { expect } from 'chai';
import { filledCount, maxMatching } from '../../../src/services/lease/memberMatch';

describe('maxMatching (a group lease: members to phones)', () => {
  it('moves the first member off a key the second member needs', () => {
    expect(maxMatching([['A', 'B'], ['A']])).to.deep.equal(['B', 'A']);
  });

  it('leaves exactly one member unfilled when two want the only key', () => {
    const match = maxMatching([['A'], ['A']]);
    expect(match.filter((key) => key === null)).to.have.length(1);
    expect(match.filter((key) => key === 'A')).to.have.length(1);
    expect(filledCount(match)).to.equal(1);
  });

  it('fills eight members with eight distinct keys', () => {
    const keys = ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8'];
    const match = maxMatching(keys.map(() => [...keys]));
    expect(match).to.have.length(8);
    expect(match.every((key) => key !== null)).to.equal(true);
    expect(new Set(match).size).to.equal(8);
    expect(filledCount(match)).to.equal(8);
  });

  it('keeps a preferred key when a maximum matching allows it', () => {
    expect(
      maxMatching(
        [
          ['A', 'B'],
          ['A', 'B'],
        ],
        ['B', null],
      ),
    ).to.deep.equal(['B', 'A']);
  });

  it('moves a preferred key when keeping it would leave a member unfilled', () => {
    expect(maxMatching([['A', 'B'], ['A']], ['A', null])).to.deep.equal(['B', 'A']);
  });

  it('gives a member with no candidates null', () => {
    expect(maxMatching([[], ['A']])).to.deep.equal([null, 'A']);
  });

  it('ignores a preferred key that is not among the member candidates', () => {
    expect(maxMatching([['A'], ['B']], ['C', null])).to.deep.equal(['A', 'B']);
  });

  it('seats only one member when two prefer the same key', () => {
    expect(
      maxMatching(
        [
          ['A', 'B'],
          ['A', 'B'],
        ],
        ['A', 'A'],
      ),
    ).to.deep.equal(['A', 'B']);
  });

  it('keeps every preferred key that a maximum matching allows', () => {
    // Member 0 holds C and member 1 holds B. Member 2 tries B first, which a
    // plain augmenting path would take by moving member 1 to A; A is free, so
    // all three are filled without moving either preferred seat.
    const match = maxMatching(
      [
        ['A', 'C'],
        ['A', 'B'],
        ['B', 'C', 'A'],
      ],
      ['C', 'B', null],
    );
    expect(match).to.deep.equal(['C', 'B', 'A']);
  });

  it('moves one hold rather than two to fill every member', () => {
    // Keeping both holds leaves member 0 unfilled. Moving member 1 off A
    // (to X) lets member 0 take A while member 2 keeps B.
    const match = maxMatching(
      [
        ['B', 'A'],
        ['A', 'X'],
        ['B', 'A'],
      ],
      [null, 'A', 'B'],
    );
    expect(match).to.deep.equal(['A', 'X', 'B']);
  });

  it('keeps both holds when two unfilled members can be seated around them', () => {
    // Members 0 and 3 hold A and B; 1 and 2 have nothing. A search that lets
    // member 1 push the holders along (0 to B, 3 to D) moves both holds and
    // still fills only three. Three are filled with both holds kept.
    const match = maxMatching(
      [
        ['B', 'A'],
        ['A', 'B'],
        ['A', 'D'],
        ['D', 'B'],
      ],
      ['A', null, null, 'B'],
    );
    expect(match).to.deep.equal(['A', null, 'D', 'B']);
  });

  it('matches a brute-force search on every small case it is given', () => {
    // Every assignment of distinct candidate keys (or null) to the members.
    const assignments = (candidates: string[][]): (string | null)[][] => {
      const out: (string | null)[][] = [];
      const walk = (member: number, current: (string | null)[], used: Set<string>): void => {
        if (member === candidates.length) {
          out.push([...current]);
          return;
        }
        walk(member + 1, [...current, null], used);
        for (const key of new Set(candidates[member])) {
          if (used.has(key)) continue;
          used.add(key);
          walk(member + 1, [...current, key], used);
          used.delete(key);
        }
      };
      walk(0, [], new Set());
      return out;
    };
    const keptBy = (match: (string | null)[], prefer: (string | null)[]): number[] =>
      match.flatMap((key, member) => (key !== null && key === prefer[member] ? [member] : []));
    const lexFirst = (a: number[], b: number[]): number[] => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] !== b[i]) return a[i] < b[i] ? a : b;
      }
      return a.length <= b.length ? a : b;
    };

    // A fixed-seed generator, so a failure names a case that can be rerun.
    let seed = 20261107;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const allKeys = ['A', 'B', 'C', 'D', 'E'];

    for (let run = 0; run < 1500; run++) {
      const members = 1 + Math.floor(random() * 5);
      const keys = allKeys.slice(0, 1 + Math.floor(random() * 5));
      const candidates = Array.from({ length: members }, () =>
        keys.filter(() => random() < 0.5).sort(() => random() - 0.5),
      );
      const prefer = candidates.map(() =>
        random() < 0.6 ? keys[Math.floor(random() * keys.length)] : null,
      );
      const where = JSON.stringify({ candidates, prefer });

      const match = maxMatching(candidates, prefer);
      expect(match, where).to.have.length(members);
      match.forEach((key, member) => {
        if (key !== null) expect(candidates[member], where).to.include(key);
      });
      const given = match.filter((key) => key !== null);
      expect(new Set(given).size, where).to.equal(given.length);

      const every = assignments(candidates);
      const best = Math.max(...every.map(filledCount));
      expect(filledCount(match), where).to.equal(best);

      const keptSets = every.filter((a) => filledCount(a) === best).map((a) => keptBy(a, prefer));
      const mostKept = Math.max(...keptSets.map((set) => set.length));
      const firstSet = keptSets.filter((set) => set.length === mostKept).reduce(lexFirst);
      expect(keptBy(match, prefer), where).to.deep.equal(firstSet);
    }
  });

  it('answers an empty group with an empty match', () => {
    expect(maxMatching([])).to.deep.equal([]);
    expect(filledCount([])).to.equal(0);
  });

  it('does not change its inputs', () => {
    const candidates = [['A', 'B'], ['A']];
    const prefer: (string | null)[] = ['A', null];
    maxMatching(candidates, prefer);
    expect(candidates).to.deep.equal([['A', 'B'], ['A']]);
    expect(prefer).to.deep.equal(['A', null]);
  });
});

describe('filledCount', () => {
  it('counts the members given a key', () => {
    expect(filledCount(['A', null, 'B', null])).to.equal(2);
  });
});
