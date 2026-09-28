import { expect } from 'chai';
import {
  XE_OPTIONS,
  XENON_OPTIONS,
  xenonOptionsIn,
  xenonOptionsOf,
} from '../../src/services/session/xenonOptions';

// `xe:options` is where Xenon's own session options live. `xenon:options` is
// still read as an alias, and when a session sends both, `xe:options` wins
// field by field. Every reader goes through these two functions, so this is
// the one place that rule is held.

const w3c = (alwaysMatch: Record<string, unknown>, firstMatch: Record<string, unknown>[] = [{}]) =>
  ({ alwaysMatch, firstMatch }) as any;

describe('xenonOptionsOf — the one precedence rule for Xenon options', () => {
  it('names the two namespaces', () => {
    expect(XE_OPTIONS).to.equal('xe:options');
    expect(XENON_OPTIONS).to.equal('xenon:options');
  });

  it('reads xe:options', () => {
    expect(xenonOptionsOf(w3c({ 'xe:options': { leaseId: 'lse_1' } }))).to.deep.equal({
      leaseId: 'lse_1',
    });
  });

  it('still reads xenon:options alone', () => {
    expect(xenonOptionsOf(w3c({ 'xenon:options': { leaseId: 'lse_1' } }))).to.deep.equal({
      leaseId: 'lse_1',
    });
  });

  it('lets xe:options win field by field when both are sent', () => {
    const options = xenonOptionsOf(
      w3c({
        'xenon:options': { leaseId: 'lse_old', healingTiers: [1, 2], sessionToken: 'jwt_old' },
        'xe:options': { leaseId: 'lse_new', accessKey: 'ak' },
      }),
    );
    expect(options).to.deep.equal({
      leaseId: 'lse_new', // both set it: xe:options
      healingTiers: [1, 2], // only xenon:options set it
      sessionToken: 'jwt_old',
      accessKey: 'ak', // only xe:options set it
    });
  });

  it('lets xe:options win even from firstMatch over xenon:options in alwaysMatch', () => {
    const options = xenonOptionsOf(
      w3c({ 'xenon:options': { leaseId: 'lse_old' } }, [{ 'xe:options': { leaseId: 'lse_new' } }]),
    );
    expect(options.leaseId).to.equal('lse_new');
  });

  it('does not let an unset or null xe:options field hide the xenon:options one', () => {
    const options = xenonOptionsOf(
      w3c({
        'xenon:options': { leaseId: 'lse_1', buildId: 'b-1' },
        'xe:options': { leaseId: undefined, buildId: null },
      }),
    );
    expect(options).to.deep.equal({ leaseId: 'lse_1', buildId: 'b-1' });
  });

  it('reads the first firstMatch entry overlaid by alwaysMatch, as allocation does', () => {
    // A key in both is invalid W3C and Appium rejects it later; until then
    // alwaysMatch's object wins outright, as it does for every capability.
    const options = xenonOptionsOf(
      w3c({ 'xe:options': { leaseId: 'lse_always' } }, [
        { 'xe:options': { leaseId: 'lse_first', leaseToken: 'tok' } },
        { 'xe:options': { leaseId: 'lse_second' } },
      ]),
    );
    expect(options).to.deep.equal({ leaseId: 'lse_always' });
  });

  it('ignores a namespace that is not an object', () => {
    expect(
      xenonOptionsOf(w3c({ 'xe:options': 'lse_1', 'xenon:options': { leaseId: 'lse_2' } })),
    ).to.deep.equal({ leaseId: 'lse_2' });
    expect(xenonOptionsOf(w3c({ 'xe:options': ['a'] }))).to.deep.equal({});
  });

  it('ignores options Xenon does not own', () => {
    expect(
      xenonOptionsOf(
        w3c({
          'df:options': { accessKey: 'ak', token: 'tk' },
          'xenon:df:options': { accessKey: 'ak', token: 'tk' },
          'appium:df:options': { accessKey: 'ak', token: 'tk' },
          'appium:options': { sessionToken: 'jwt' },
        }),
      ),
    ).to.deep.equal({});
  });

  it('copes with missing or malformed capabilities', () => {
    expect(xenonOptionsOf(undefined as any)).to.deep.equal({});
    expect(xenonOptionsOf({} as any)).to.deep.equal({});
    expect(xenonOptionsOf({ alwaysMatch: null, firstMatch: 'x' } as any)).to.deep.equal({});
  });

  it('returns a copy, so a reader cannot change the capabilities through it', () => {
    const caps = w3c({ 'xe:options': { leaseId: 'lse_1' } });
    xenonOptionsOf(caps).leaseId = 'changed';
    expect(caps.alwaysMatch['xe:options'].leaseId).to.equal('lse_1');
  });
});

describe('xenonOptionsIn — the same rule over one flat capability map', () => {
  // A session's returned capabilities, or a stored desired-capabilities row,
  // is one flat map rather than alwaysMatch + firstMatch.
  it('lets xe:options win field by field', () => {
    expect(
      xenonOptionsIn({
        'xenon:options': { healingTiers: [1], buildId: 'b-1' },
        'xe:options': { healingTiers: [2, 3] },
      }),
    ).to.deep.equal({ healingTiers: [2, 3], buildId: 'b-1' });
  });

  it('is empty for anything that is not a capability map', () => {
    expect(xenonOptionsIn(undefined)).to.deep.equal({});
    expect(xenonOptionsIn(null)).to.deep.equal({});
    expect(xenonOptionsIn('xe:options')).to.deep.equal({});
    expect(xenonOptionsIn([{ 'xe:options': { a: 1 } }])).to.deep.equal({});
  });
});
