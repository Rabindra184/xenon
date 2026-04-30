import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  ensureLegacyNodeUser,
  resetLegacyNodeUserCache,
} from '../../src/services/identity/legacyNodeUser';
import { prisma } from '../../src/prisma';

describe('ensureLegacyNodeUser', () => {
  beforeEach(() => resetLegacyNodeUserCache());
  afterEach(() => sinon.restore());

  it('returns existing row when one is found', async () => {
    sinon.stub(prisma.user, 'findUnique').resolves({
      id: 'u-existing',
    } as any);
    const create = sinon.stub(prisma.user, 'create');
    const out = await ensureLegacyNodeUser();
    expect(out.id).to.equal('u-existing');
    expect(create.called).to.be.false;
  });

  it('creates a row with INACTIVE + unusable hash + ADMIN role when none exists', async () => {
    sinon.stub(prisma.user, 'findUnique').resolves(null);
    const create = sinon.stub(prisma.user, 'create').resolves({ id: 'u-new' } as any);
    const out = await ensureLegacyNodeUser();
    expect(out.id).to.equal('u-new');
    const data = create.firstCall.args[0].data;
    expect(data.email).to.equal('legacy-node@xenon.local');
    expect(data.status).to.equal('INACTIVE');
    expect(data.role).to.equal('ADMIN');
    expect(data.passwordHash).to.match(/^\$2[ayb]\$04\$invalid/);
  });

  it('caches the id in module scope after first lookup', async () => {
    const findOne = sinon.stub(prisma.user, 'findUnique').resolves({
      id: 'u-cached',
    } as any);
    await ensureLegacyNodeUser();
    await ensureLegacyNodeUser();
    expect(findOne.calledOnce).to.be.true;
  });

  it('handles concurrent first-create races (P2002) by re-fetching', async () => {
    let lookupCalls = 0;
    (sinon.stub(prisma.user, 'findUnique') as any).callsFake(async () => {
      lookupCalls += 1;
      if (lookupCalls === 1) return null;
      return { id: 'u-race' } as any;
    });
    sinon.stub(prisma.user, 'create').rejects(
      Object.assign(new Error('Unique constraint violated'), { code: 'P2002' }),
    );
    const out = await ensureLegacyNodeUser();
    expect(out.id).to.equal('u-race');
    expect(lookupCalls).to.equal(2);
  });
});
