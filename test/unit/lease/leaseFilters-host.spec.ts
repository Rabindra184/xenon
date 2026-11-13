import { expect } from 'chai';
import {
  clientFilters,
  hostProblem,
  memberMatches,
} from '../../../src/services/lease/leaseFilters';

/**
 * A hub and its node can each report a phone with the same udid (an
 * emulator's `emulator-5554`). `filters.host` asks for the phone on one
 * server, matched exactly as `/control` matches it: never a prefix or a
 * substring, so `http://a:4723` is not `http://a:47230`.
 */
describe('A lease filter by host', () => {
  it('takes only a phone whose host is exactly the one asked for', () => {
    const matches = memberMatches({ platform: 'android', host: 'http://a:4723' });

    expect(matches({ host: 'http://a:4723' })).to.equal(true);
    expect(matches({ host: 'http://a:47230' })).to.equal(false);
    expect(matches({ host: 'http://b:4723' })).to.equal(false);
  });

  it('matches any host when none is asked for', () => {
    const matches = memberMatches({ platform: 'android' });

    expect(matches({ host: 'http://a:4723' })).to.equal(true);
    expect(matches({ host: 'http://b:4723' })).to.equal(true);
  });

  it('is not sent to the device store, which matches hosts loosely', () => {
    const out = clientFilters({ platform: 'android', udid: 'e', host: 'http://a:4723' });

    expect(out).to.not.have.property('host');
    expect(out.udid).to.equal('e');
  });

  it('reads an absent host or a non-empty string', () => {
    expect(hostProblem({})).to.equal(null);
    expect(hostProblem({ host: 'http://a:4723' })).to.equal(null);
  });

  it("refuses anything else as not a server's host", () => {
    for (const host of ['', 3, []]) {
      expect(hostProblem({ host }), JSON.stringify(host)).to.equal("host must be a server's host");
    }
  });
});
