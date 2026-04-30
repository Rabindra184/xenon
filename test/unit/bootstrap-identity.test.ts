import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { bootstrapIdentity } from '../../src/services/identity/bootstrap';
import { prisma } from '../../src/prisma';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';

describe('bootstrapIdentity', () => {
  afterEach(() => sinon.restore());

  it('creates a super-admin on a fresh DB', async () => {
    sinon.stub(prisma.user, 'count').resolves(0);
    const create = sinon.stub(Container.get(UserService), 'createUser')
      .resolves({ id: 'super', role: 'SUPER_ADMIN' } as any);

    await bootstrapIdentity();

    expect(create.calledOnce).to.be.true;
    expect(create.firstCall.args[0].role).to.equal('SUPER_ADMIN');
  });

  it('is a no-op when users already exist', async () => {
    sinon.stub(prisma.user, 'count').resolves(1);
    const create = sinon.stub(Container.get(UserService), 'createUser');

    await bootstrapIdentity();

    expect(create.called).to.be.false;
  });

  it('XENON_BOOTSTRAP_RESET_PASSWORD=true rotates the super-admin password', async () => {
    sinon.stub(prisma.user, 'count').resolves(2);
    sinon.stub(prisma.user, 'findFirst').resolves({ id: 'super' } as any);
    const update = sinon.stub(prisma.user, 'update').resolves({} as any);
    sinon.stub(prisma.userSession, 'deleteMany').resolves({ count: 1 } as any);

    process.env.XENON_BOOTSTRAP_RESET_PASSWORD = 'true';
    process.env.XENON_BOOTSTRAP_ADMIN_PASSWORD = 'NewPw1234';
    try {
      // Need to refresh config since it reads env at module load. If config is
      // cached, mutate the singleton directly.
      const cfg = require('../../src/config').config;
      const origReset = cfg.bootstrapResetPassword;
      const origPw = cfg.bootstrapAdminPassword;
      cfg.bootstrapResetPassword = true;
      cfg.bootstrapAdminPassword = 'NewPw1234';
      try {
        await bootstrapIdentity();
        expect(update.calledOnce).to.be.true;
      } finally {
        cfg.bootstrapResetPassword = origReset;
        cfg.bootstrapAdminPassword = origPw;
      }
    } finally {
      delete process.env.XENON_BOOTSTRAP_RESET_PASSWORD;
      delete process.env.XENON_BOOTSTRAP_ADMIN_PASSWORD;
    }
  });
});
