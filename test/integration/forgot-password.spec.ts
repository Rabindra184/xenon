import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authPublicRouter } from '../../src/app/routers/auth';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { PasswordResetService } from '../../src/services/PasswordResetService';
import { prisma } from '../../src/prisma';

describe('forgot-password flow (integration)', function () {
  this.timeout(30_000);
  let user: any;
  const email = 'forgot-it@xenon.local';

  before(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { user: { email } } });
    await prisma.userSession.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    user = await Container.get(UserService).createUser({
      email,
      name: 'Forgot IT',
      password: 'old-password-1',
      role: 'ADMIN',
    });
  });
  after(async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/auth', authPublicRouter());
    return app;
  }

  it('full flow: forgot -> DB token -> reset -> login with new password', async () => {
    const app = buildApp();

    // Generic 204 even with wrong email
    const r1 = await request(app).post('/auth/forgot-password').send({ email: 'no@no.com' });
    expect(r1.status).to.equal(204);

    const r2 = await request(app).post('/auth/forgot-password').send({ email });
    expect(r2.status).to.equal(204);

    // Generate a token via the service directly so we have the raw value to reset with
    const { raw } = await Container.get(PasswordResetService).createToken(user.id);

    const check = await request(app).get(`/auth/reset-password/check/${raw}`);
    expect(check.status).to.equal(200);

    const reset = await request(app)
      .post('/auth/reset-password')
      .send({ token: raw, newPassword: 'NewPassw0rd1' });
    expect(reset.status).to.equal(204);

    // Token now consumed
    const recheck = await request(app).get(`/auth/reset-password/check/${raw}`);
    expect(recheck.status).to.equal(404);

    // Login with new password works
    const login = await request(app)
      .post('/auth/login')
      .send({ email, password: 'NewPassw0rd1' });
    expect(login.status).to.equal(204);

    // Login with old password fails
    const oldLogin = await request(app)
      .post('/auth/login')
      .send({ email, password: 'old-password-1' });
    expect(oldLogin.status).to.equal(401);
  });

  it('expired token returns 404 from check', async () => {
    const { raw, id } = await Container.get(PasswordResetService).createToken(user.id);
    await prisma.passwordResetToken.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const app = buildApp();
    const r = await request(app).get(`/auth/reset-password/check/${raw}`);
    expect(r.status).to.equal(404);
  });
});
