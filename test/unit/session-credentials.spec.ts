import { expect } from 'chai';
import {
  SECRET_OPTION_FIELDS,
  capsWithCredentials,
  takeSessionCredentials,
} from '../../src/services/session/sessionCredentials';

// The credentials a session presents in `xe:options` (or its alias
// `xenon:options`) are bearer secrets. createSession reads them once and takes
// them out of the capabilities, in place, before anything else reads them.

const SECRETS = {
  accessKey: 'xen_SECRET_KEY',
  token: 'SECRET_TOKEN',
  sessionToken: 'SECRET_JWT',
  leaseToken: 'f'.repeat(64),
};

const allSecrets = Object.values(SECRETS);
const leaks = (value: unknown) =>
  allSecrets.filter((s) => JSON.stringify(value ?? null).includes(s));

describe('takeSessionCredentials', () => {
  it('names exactly the four secret fields', () => {
    expect([...SECRET_OPTION_FIELDS].sort()).to.deep.equal(
      ['accessKey', 'leaseToken', 'sessionToken', 'token'].sort(),
    );
  });

  it('reads every credential from xe:options', () => {
    const caps: any = { alwaysMatch: { 'xe:options': { leaseId: 'lse_1', ...SECRETS } } };
    expect(takeSessionCredentials(caps)).to.deep.equal({
      pair: { accessKey: SECRETS.accessKey, token: SECRETS.token },
      sessionToken: SECRETS.sessionToken,
      leaseToken: SECRETS.leaseToken,
    });
  });

  it('still reads them from xenon:options alone', () => {
    const caps: any = { alwaysMatch: { 'xenon:options': { leaseId: 'lse_1', ...SECRETS } } };
    expect(takeSessionCredentials(caps)).to.deep.equal({
      pair: { accessKey: SECRETS.accessKey, token: SECRETS.token },
      sessionToken: SECRETS.sessionToken,
      leaseToken: SECRETS.leaseToken,
    });
  });

  it('lets xe:options win field by field', () => {
    const caps: any = {
      alwaysMatch: {
        'xenon:options': { accessKey: 'ak_old', token: 'tk_old', sessionToken: 'jwt_old' },
        'xe:options': { token: 'tk_new', sessionToken: 'jwt_new' },
      },
    };
    expect(takeSessionCredentials(caps)).to.deep.equal({
      pair: { accessKey: 'ak_old', token: 'tk_new' },
      sessionToken: 'jwt_new',
      leaseToken: null,
    });
  });

  it('reads nothing from df:options, and leaves it alone', () => {
    const df = { accessKey: 'ak', token: 'tk', sessionToken: 'jwt' };
    const caps: any = { alwaysMatch: { 'df:options': { ...df } } };
    expect(takeSessionCredentials(caps)).to.deep.equal({
      pair: undefined,
      sessionToken: null,
      leaseToken: null,
    });
    expect(caps.alwaysMatch['df:options']).to.deep.equal(df);
  });

  it('strips the secrets in place from both namespaces, in alwaysMatch and every firstMatch', () => {
    const caps: any = {
      alwaysMatch: {
        platformName: 'Android',
        'xe:options': { leaseId: 'lse_1', healingTiers: [1, 2], ...SECRETS },
      },
      firstMatch: [
        { 'xenon:options': { buildId: 'b-1', ...SECRETS } },
        { 'xe:options': { ...SECRETS } },
        { 'xenon:options': { accessKey: SECRETS.accessKey, token: SECRETS.token } },
      ],
    };
    const alwaysMatch = caps.alwaysMatch;
    const second = caps.firstMatch[1];

    takeSessionCredentials(caps);

    expect(leaks(caps)).to.deep.equal([]);
    // In place: Appium hands this same object to the driver.
    expect(caps.alwaysMatch).to.equal(alwaysMatch);
    expect(caps.firstMatch[1]).to.equal(second);
    // Everything that is not a secret stays, the lease id included.
    expect(caps.alwaysMatch).to.deep.equal({
      platformName: 'Android',
      'xe:options': { leaseId: 'lse_1', healingTiers: [1, 2] },
    });
    expect(caps.firstMatch[0]).to.deep.equal({ 'xenon:options': { buildId: 'b-1' } });
  });

  it('strips a secret it did not honour: a lease token away from the lease id', () => {
    const caps: any = {
      alwaysMatch: { 'xe:options': { leaseId: 'lse_1' } },
      firstMatch: [{ 'xe:options': { leaseToken: SECRETS.leaseToken } }],
    };
    expect(takeSessionCredentials(caps).leaseToken).to.equal(null);
    expect(leaks(caps)).to.deep.equal([]);
  });

  it('leaves a session with no Xenon options untouched', () => {
    const caps: any = { alwaysMatch: { platformName: 'iOS' }, firstMatch: [{}] };
    takeSessionCredentials(caps);
    expect(caps).to.deep.equal({ alwaysMatch: { platformName: 'iOS' }, firstMatch: [{}] });
  });

  it('copes with missing buckets', () => {
    expect(() => takeSessionCredentials({} as any)).to.not.throw();
    expect(() =>
      takeSessionCredentials({ alwaysMatch: null, firstMatch: 'x' } as any),
    ).to.not.throw();
  });
});

describe('capsWithCredentials — the copy a peer Xenon node gets', () => {
  // A peer node re-runs createSession: it authenticates and attributes the
  // session and checks the lease itself, so it needs what the hub read. It
  // takes the credentials out again before its own driver sees them.
  const take = (caps: any) => ({ caps, credentials: takeSessionCredentials(caps) });

  it('puts every credential back, so the node reads the same ones the hub did', () => {
    const { caps, credentials } = take({
      alwaysMatch: {
        'xenon:options': { leaseId: 'lse_1', accessKey: 'ak_old', token: 'tk_old' },
        'xe:options': { token: SECRETS.token, sessionToken: SECRETS.sessionToken },
      },
      firstMatch: [{}],
    });
    const forwarded = capsWithCredentials(caps, credentials);
    expect(takeSessionCredentials(JSON.parse(JSON.stringify(forwarded)))).to.deep.equal(
      credentials,
    );
  });

  it('writes them into the namespace that wins, in the bucket it is in', () => {
    const { caps, credentials } = take({
      alwaysMatch: { 'xenon:options': { leaseId: 'lse_1', leaseToken: SECRETS.leaseToken } },
      firstMatch: [{ 'xe:options': { accessKey: SECRETS.accessKey, token: SECRETS.token } }],
    });
    const forwarded: any = capsWithCredentials(caps, credentials);
    expect(forwarded.firstMatch[0]['xe:options']).to.deep.equal({
      accessKey: SECRETS.accessKey,
      token: SECRETS.token,
      leaseToken: SECRETS.leaseToken,
    });
    expect(forwarded.alwaysMatch['xenon:options']).to.deep.equal({ leaseId: 'lse_1' });
  });

  it('does not modify the caps it copies', () => {
    const { caps, credentials } = take({
      alwaysMatch: { 'xe:options': { leaseId: 'lse_1', ...SECRETS } },
      firstMatch: [{}],
    });
    const before = JSON.stringify(caps);
    capsWithCredentials(caps, credentials);
    expect(JSON.stringify(caps)).to.equal(before);
    expect(leaks(caps)).to.deep.equal([]);
  });

  it('returns the caps unchanged when there is nothing to put back', () => {
    const { caps, credentials } = take({
      alwaysMatch: { 'xe:options': { leaseId: 'lse_1' } },
      firstMatch: [{}],
    });
    expect(capsWithCredentials(caps, credentials)).to.equal(caps);
  });
});
