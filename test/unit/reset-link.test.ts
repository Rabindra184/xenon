import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import { usersRouter } from '../../src/app/routers/users';
import { authPublicRouter, authAuthedRouter } from '../../src/app/routers/auth';
import { UserSessionService } from '../../src/services/UserSessionService';
import { PasswordResetService } from '../../src/services/PasswordResetService';
import { EmailService } from '../../src/services/EmailService';
import { UserService } from '../../src/services/UserService';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';
import log from '../../src/logger';
import { buildResetLink } from '../../src/services/passwordResetLink';

const RAW = 'RAWTOKEN_abcdefghijklmnopqrstuvwxyz0123456789';

function usersApp(auth: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = auth;
    next();
  });
  app.use('/users', usersRouter());
  return app;
}

function withConfig(patch: Record<string, unknown>) {
  const orig: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) {
    orig[k] = (config as any)[k];
    (config as any)[k] = patch[k];
  }
  return () => Object.assign(config as any, orig);
}

describe('password-reset links', () => {
  let restore: () => void;
  afterEach(() => {
    sinon.restore();
    restore?.();
  });

  describe('POST /users/:id/reset-link', () => {
    const member = { id: 'm1', email: 'm@x.local', name: 'Mem', role: 'MEMBER', status: 'ACTIVE' };

    it('without SMTP, returns the link once to the admin and never logs it', async () => {
      restore = withConfig({ smtpUrl: undefined, passwordResetLogFallback: false });
      sinon.stub(prisma.user, 'findUnique').resolves(member as any);
      sinon
        .stub(Container.get(PasswordResetService), 'createToken')
        .resolves({ raw: RAW, id: 't1' });
      const send = sinon.stub(Container.get(EmailService), 'send').resolves();
      // log.scope() builds a new logger per call, so stub the base logger all
      // scopes share — that is what the router's audit line really goes to.
      const base = (log as any).baseLogger;
      const logged: string[] = [];
      for (const lvl of ['info', 'warn', 'debug', 'error']) {
        sinon.stub(base, lvl).callsFake((...args: unknown[]) => {
          logged.push(args.map(String).join(' '));
        });
      }

      const r = await request(usersApp({ userId: 'admin1', role: 'ADMIN' })).post(
        '/users/m1/reset-link',
      );

      expect(r.status).to.equal(200);
      expect(r.body.emailed).to.equal(false);
      expect(r.body.link).to.match(new RegExp(`/xenon/reset-password#${RAW}$`));
      expect(r.headers['cache-control']).to.equal('no-store');
      expect(send.called).to.equal(false);
      expect(logged.join('\n')).to.include('issued a password-reset link for user m1');
      expect(logged.join('\n')).to.not.include(RAW);
    });

    it('with SMTP, emails the user and returns no link', async () => {
      restore = withConfig({ smtpUrl: 'smtp://mail.example.com:587' });
      sinon.stub(prisma.user, 'findUnique').resolves(member as any);
      sinon
        .stub(Container.get(PasswordResetService), 'createToken')
        .resolves({ raw: RAW, id: 't1' });
      const send = sinon.stub(Container.get(EmailService), 'send').resolves();

      const r = await request(usersApp({ userId: 'admin1', role: 'ADMIN' })).post(
        '/users/m1/reset-link',
      );

      expect(r.status).to.equal(200);
      expect(r.body).to.include({ emailed: true });
      expect(r.body).to.not.have.property('link');
      expect(send.firstCall.args[0].to).to.equal('m@x.local');
      expect(send.firstCall.args[0].text).to.include(RAW);
    });

    it('refuses an ADMIN issuing a link for a SUPER_ADMIN (account takeover)', async () => {
      sinon
        .stub(prisma.user, 'findUnique')
        .resolves({ ...member, id: 's1', role: 'SUPER_ADMIN' } as any);
      const create = sinon.stub(Container.get(PasswordResetService), 'createToken');

      const r = await request(usersApp({ userId: 'admin1', role: 'ADMIN' })).post(
        '/users/s1/reset-link',
      );

      expect(r.status).to.equal(403);
      expect(create.called).to.equal(false);
    });

    it('refuses an ADMIN issuing a link for another ADMIN', async () => {
      sinon.stub(prisma.user, 'findUnique').resolves({ ...member, id: 'a2', role: 'ADMIN' } as any);
      const create = sinon.stub(Container.get(PasswordResetService), 'createToken');
      const r = await request(usersApp({ userId: 'admin1', role: 'ADMIN' })).post(
        '/users/a2/reset-link',
      );
      expect(r.status).to.equal(403);
      expect(create.called).to.equal(false);
    });

    it('refuses a link for yourself', async () => {
      const create = sinon.stub(Container.get(PasswordResetService), 'createToken');
      const r = await request(usersApp({ userId: 'me', role: 'SUPER_ADMIN' })).post(
        '/users/me/reset-link',
      );
      expect(r.status).to.equal(400);
      expect(create.called).to.equal(false);
    });

    it('404s an unknown user and 409s a disabled one, minting nothing', async () => {
      const find = sinon.stub(prisma.user, 'findUnique');
      const create = sinon.stub(Container.get(PasswordResetService), 'createToken');
      const app = usersApp({ userId: 'root', role: 'SUPER_ADMIN' });

      find.resolves(null);
      expect((await request(app).post('/users/nope/reset-link')).status).to.equal(404);
      find.resolves({ ...member, status: 'DISABLED' } as any);
      expect((await request(app).post('/users/m1/reset-link')).status).to.equal(409);
      expect(create.called).to.equal(false);
    });
  });

  describe('POST /auth/forgot-password', () => {
    function authApp() {
      const app = express();
      app.use(express.json());
      app.use('/auth', authPublicRouter());
      return app;
    }
    // The route answers 204 first and does the work afterwards
    // (anti-enumeration), so wait for the work itself rather than a fixed
    // sleep: a 120ms sleep occasionally lost to a cold ts-node start.
    async function until(pred: () => boolean, ms = 3000) {
      const t0 = Date.now();
      while (!pred()) {
        if (Date.now() - t0 > ms) throw new Error('timed out waiting for the route to finish');
        await new Promise((r) => setTimeout(r, 5));
      }
    }

    it('mints no token when nothing can deliver it', async () => {
      restore = withConfig({ smtpUrl: undefined, passwordResetLogFallback: false });
      sinon
        .stub(Container.get(UserService), 'findByEmail')
        .resolves({ id: 'u1', email: 'u@x.local', name: 'U', status: 'ACTIVE' } as any);
      const find = Container.get(UserService).findByEmail as sinon.SinonStub;
      const create = sinon.stub(Container.get(PasswordResetService), 'createToken');

      const r = await request(authApp()).post('/auth/forgot-password').send({ email: 'u@x.local' });
      // The mint-or-skip decision runs in the same continuation as the user
      // lookup, so once the lookup has resolved and a macrotask has passed,
      // createToken has either been called or never will be.
      await until(() => find.called);
      await new Promise((r) => setImmediate(r));

      expect(r.status).to.equal(204);
      expect(create.called).to.equal(false);
    });

    it('still mints and sends when SMTP is configured', async () => {
      restore = withConfig({ smtpUrl: 'smtp://mail.example.com:587' });
      sinon
        .stub(Container.get(UserService), 'findByEmail')
        .resolves({ id: 'u1', email: 'u@x.local', name: 'U', status: 'ACTIVE' } as any);
      sinon
        .stub(Container.get(PasswordResetService), 'createToken')
        .resolves({ raw: RAW, id: 't1' });
      const send = sinon.stub(Container.get(EmailService), 'send').resolves();

      await request(authApp()).post('/auth/forgot-password').send({ email: 'u@x.local' });
      await until(() => send.called);

      expect(send.calledOnce).to.equal(true);
      expect(send.firstCall.args[0].text).to.include(`/xenon/reset-password#${RAW}`);
    });
  });

  describe('token placement (never in a URL the server sees)', () => {
    it('puts the token in the fragment, which browsers never send', () => {
      const link = buildResetLink({ secure: false, headers: { host: 'lab:4723' } } as any, RAW);
      expect(link).to.equal(`http://lab:4723/xenon/reset-password#${RAW}`);
      expect(new URL(link).pathname).to.not.include(RAW);
    });

    it('checks a token by POST body; the old GET-in-path route is gone', async () => {
      const app = express();
      app.use(express.json());
      app.use('/auth', authPublicRouter());
      const verify = sinon
        .stub(Container.get(PasswordResetService), 'verifyToken')
        .resolves({ id: 't1', userId: 'u1' });

      const ok = await request(app).post('/auth/reset-password/check').send({ token: RAW });
      expect(ok.status).to.equal(200);
      expect(verify.firstCall.args[0]).to.equal(RAW);

      const old = await request(app).get(`/auth/reset-password/check/${RAW}`);
      expect(old.status).to.equal(404);
    });
  });

  describe('a password change kills every outstanding reset link', () => {
    it('on reset: the other links for that user are revoked, not left live for their hour', async () => {
      const app = express();
      app.use(express.json());
      app.use('/auth', authPublicRouter());
      const reset = Container.get(PasswordResetService);
      sinon.stub(reset, 'verifyToken').resolves({ id: 't1', userId: 'u1' });
      sinon.stub(Container.get(UserService), 'hashPassword').resolves('hash');
      sinon.stub(prisma.user, 'update').resolves({} as any);
      sinon.stub(reset, 'consume').resolves();
      sinon.stub(Container.get(UserSessionService), 'revokeAllForUser').resolves();
      const revoke = sinon.stub(reset, 'revokeAllForUser').resolves(2);

      const r = await request(app)
        .post('/auth/reset-password')
        .send({ token: RAW, newPassword: 'a-new-password' });

      expect(r.status).to.equal(204);
      expect(revoke.calledOnceWith('u1')).to.equal(true);
    });

    it('on change-password: outstanding links are revoked too', async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).auth = { userId: 'u1', sessionId: 's1' };
        next();
      });
      app.use('/auth', authAuthedRouter());
      sinon.stub(Container.get(UserService), 'changePassword').resolves();
      sinon.stub(Container.get(UserSessionService), 'revokeAllForUserExcept').resolves();
      const revoke = sinon
        .stub(Container.get(PasswordResetService), 'revokeAllForUser')
        .resolves(1);

      const r = await request(app)
        .post('/auth/change-password')
        .send({ oldPassword: 'old-password', newPassword: 'new-password' });

      expect(r.status).to.equal(204);
      expect(revoke.calledOnceWith('u1')).to.equal(true);
    });
  });
});
