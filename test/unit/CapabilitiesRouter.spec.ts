import { expect } from 'chai';
import { buildCapabilities } from '../../src/app/routers/capabilities';

describe('capabilities payload', () => {
  it('reports version and the hub feature set', () => {
    const caps = buildCapabilities();
    expect(caps.version).to.be.a('string').and.not.equal('');
    expect(caps.features).to.deep.equal({
      bearerAuth: true,
      tokenIssuance: true,
      streamTickets: true,
      leases: true,
      eventLog: true,
      projects: true,
    });
  });
});
