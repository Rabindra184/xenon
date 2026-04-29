import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authPublicRouter } from '../../src/app/routers/auth';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { PasswordResetService } from '../../src/services/PasswordResetService';
import { prisma } from '../../src/prisma';

describe('reset-password revokes all sessions', function () {
  this.timeout(30_000);
  const email = 'reset-revokes-it@xenon.local';
  let user: any;

  before(async () => {
    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    user = await Container.get(UserService).createUser({
      email,
      name: 'Reset Revokes IT',
      password: 'old-password-1',
      role: 'MEMBER',
    });
  });
  after(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('deletes every UserSession for the resetting user', async () => {
    const sessions = [
      await Container.get(UserSessionService).create(user.id),
      await Container.get(UserSessionService).create(user.id),
    ];
    expect(sessions.length).to.equal(2);

    const { raw } = await Container.get(PasswordResetService).createToken(user.id);
    const app = express();
    app.use(express.json());
    app.use('/auth', authPublicRouter());
    const r = await request(app)
      .post('/auth/reset-password')
      .send({ token: raw, newPassword: 'BrandNewPw1' });
    expect(r.status).to.equal(204);

    const remaining = await prisma.userSession.count({ where: { userId: user.id } });
    expect(remaining).to.equal(0);
  });
});
