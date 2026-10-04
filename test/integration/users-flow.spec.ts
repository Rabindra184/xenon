import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { usersRouter } from '../../src/app/routers/users';
import { useScratchDatabase } from '../helpers/scratch-database';
import { seedUser, SeededUser } from '../helpers/seedUser';

describe('users CRUD flow (integration)', function () {
  this.timeout(60_000);
  useScratchDatabase({ wholeSuite: true });
  let sa: SeededUser;
  let admin: SeededUser;

  before(async () => {
    sa = await seedUser('SUPER_ADMIN', { name: 'Flow SA' });
    admin = await seedUser('ADMIN', { name: 'Flow Admin' });
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(authMiddleware);
    app.use('/users', usersRouter());
    return app;
  }

  it('SA creates an admin -> admin creates a member -> admin lists', async () => {
    const app = buildApp();

    // ADMIN role-create — should fail with 403 (admin can't create admins).
    const denied = await request(app)
      .post('/users')
      .set('Cookie', admin.cookie)
      .send({ email: 'flow-admin2@xenon.local', name: 'Admin 2', role: 'ADMIN' });
    expect(denied.status).to.equal(403);

    // SA creates a member.
    const memberEmail = `flow-bob-${Date.now()}@xenon.local`;
    const created = await request(app)
      .post('/users')
      .set('Cookie', sa.cookie)
      .send({ email: memberEmail, name: 'Bob', role: 'MEMBER' });
    expect(created.status).to.equal(201);
    expect(created.body.temporaryPassword).to.match(/^[A-Za-z0-9_-]{12,}$/);

    // Admin lists — sees the new member; does NOT see SA or other admins.
    const listAdmin = await request(app).get('/users').set('Cookie', admin.cookie);
    expect(listAdmin.status).to.equal(200);
    const emailsAdmin = listAdmin.body.map((u: any) => u.email);
    expect(emailsAdmin).to.include(memberEmail);
    expect(emailsAdmin).to.not.include(sa.user.email);

    // SA lists — sees everyone.
    const listSA = await request(app).get('/users').set('Cookie', sa.cookie);
    const emailsSA = listSA.body.map((u: any) => u.email);
    expect(emailsSA).to.include(sa.user.email);
    expect(emailsSA).to.include(admin.user.email);
    expect(emailsSA).to.include(memberEmail);
  });
});
