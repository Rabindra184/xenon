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
