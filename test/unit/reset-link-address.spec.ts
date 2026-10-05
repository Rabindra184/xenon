import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import { usersRouter } from '../../src/app/routers/users';
import { authPublicRouter } from '../../src/app/routers/auth';
import { PasswordResetService } from '../../src/services/PasswordResetService';
import { EmailService } from '../../src/services/EmailService';
import { UserService } from '../../src/services/UserService';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';
import { passwordResetMode } from '../../src/services/passwordResetMode';
import { buildResetLink, resetEmail, resetLinkBase } from '../../src/services/passwordResetLink';

/**
 * Where a password reset link that Xenon sends points.
 *
 * Through 2.14 it was built from the Host header of the request that asked
 * for it. Anyone could ask for a reset of someone else's account with a Host
 * of their own choosing (a matching Origin passes the CSRF check), and with
 * SMTP set up Xenon emailed the victim a genuine link to the attacker's host:
 * opening it handed the attacker the token, which opens the account.
 *
 * A link Xenon emails or logs is now built from XENON_PUBLIC_URL, the address
 * people open the dashboard at. Without it Xenon sends no link at all: the
 * sign-in page sends people to an administrator, and an administrator's
 * "send reset link" hands the link back to them instead of emailing it.
 */

const RAW = 'RAWTOKEN_abcdefghijklmnopqrstuvwxyz0123456789';
const EVIL = 'attacker.example';

function withConfig(patch: Record<string, unknown>) {
  const orig: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) {
    orig[k] = (config as any)[k];
    (config as any)[k] = patch[k];
  }
  return () => Object.assign(config as any, orig);
}

async function until(pred: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for the route to finish');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('password reset links point at XENON_PUBLIC_URL, never the request', () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    sinon.restore();
    restore?.();
    restore = undefined;
  });

  function publicApp() {
    const app = express();
    app.use(express.json());
    app.use('/auth', authPublicRouter());
    return app;
  }

  function usersApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).auth = {
        userId: 'admin1',
        role: 'ADMIN',
        scopes: 'admin,devices,sessions,read',
      };
      next();
    });
    app.use('/users', usersRouter());
    return app;
  }

  const active = { id: 'u1', email: 'u@x.local', name: 'U', role: 'MEMBER', status: 'ACTIVE' };

  describe('POST /auth/forgot-password', () => {
    it('emails a link to XENON_PUBLIC_URL whatever Host the request names', async () => {
      restore = withConfig({
        smtpUrl: 'smtp://mail.example.com:587',
        publicUrl: 'https://xenon.example.com',
      });
      sinon.stub(Container.get(UserService), 'findByEmail').resolves(active as any);
      sinon
        .stub(Container.get(PasswordResetService), 'createToken')
        .resolves({ raw: RAW, id: 't1' });
      const send = sinon.stub(Container.get(EmailService), 'send').resolves();

      await request(publicApp())
        .post('/auth/forgot-password')
        .set('Host', EVIL)
        .set('X-Forwarded-Proto', 'http')
        .send({ email: 'u@x.local' });
      await until(() => send.called);

      const text = send.firstCall.args[0].text as string;
      expect(text).to.include(`https://xenon.example.com/xenon/reset-password#${RAW}`);
      expect(text).to.not.include(EVIL);
    });

    it("builds a link that opens when XENON_PUBLIC_URL is the dashboard's address", async () => {
      restore = withConfig({
        smtpUrl: 'smtp://mail.example.com:587',
        publicUrl: 'http://localhost:4723/xenon/',
      });
      sinon.stub(Container.get(UserService), 'findByEmail').resolves(active as any);
      sinon
        .stub(Container.get(PasswordResetService), 'createToken')
        .resolves({ raw: RAW, id: 't1' });
      const send = sinon.stub(Container.get(EmailService), 'send').resolves();

      await request(publicApp()).post('/auth/forgot-password').send({ email: 'u@x.local' });
      await until(() => send.called);

      expect(send.firstCall.args[0].text).to.include(
        `http://localhost:4723/xenon/reset-password#${RAW}`,
      );
      expect(send.firstCall.args[0].text).to.not.include('/xenon/xenon/');
    });

    it('sends nothing, and mints nothing, when XENON_PUBLIC_URL is not set', async () => {
      restore = withConfig({ smtpUrl: 'smtp://mail.example.com:587', publicUrl: undefined });
      const find = sinon.stub(Container.get(UserService), 'findByEmail').resolves(active as any);
      const create = sinon.stub(Container.get(PasswordResetService), 'createToken');
      const send = sinon.stub(Container.get(EmailService), 'send').resolves();

      const r = await request(publicApp())
        .post('/auth/forgot-password')
        .set('Host', EVIL)
        .send({ email: 'u@x.local' });
      await until(() => find.called);
      await new Promise((resolve) => setImmediate(resolve));

      expect(r.status).to.equal(204);
      expect(create.called).to.equal(false);
      expect(send.called).to.equal(false);
    });

    it('sends nothing through the log fallback without XENON_PUBLIC_URL either', async () => {
      restore = withConfig({
        smtpUrl: undefined,
        passwordResetLogFallback: true,
        publicUrl: undefined,
      });
      const find = sinon.stub(Container.get(UserService), 'findByEmail').resolves(active as any);
      const create = sinon.stub(Container.get(PasswordResetService), 'createToken');

      await request(publicApp()).post('/auth/forgot-password').send({ email: 'u@x.local' });
      await until(() => find.called);
      await new Promise((resolve) => setImmediate(resolve));

      expect(create.called).to.equal(false);
    });
  });

  describe('GET /auth/options tells the sign-in page whether self-service reset works', () => {
    it("is 'admin' with SMTP but no XENON_PUBLIC_URL, 'email' with both", async () => {
      restore = withConfig({ smtpUrl: 'smtp://mail.example.com:587', publicUrl: undefined });
      expect((await request(publicApp()).get('/auth/options')).body.passwordReset).to.equal(
        'admin',
      );
      (config as any).publicUrl = 'https://xenon.example.com';
      expect((await request(publicApp()).get('/auth/options')).body.passwordReset).to.equal(
        'email',
      );
    });
  });

  describe('POST /users/:id/reset-link', () => {
    beforeEach(() => {
      sinon.stub(prisma.user, 'findUnique').resolves(active as any);
      sinon
        .stub(Container.get(PasswordResetService), 'createToken')
        .resolves({ raw: RAW, id: 't1' });
    });

    it('emails a link to XENON_PUBLIC_URL whatever Host the request names', async () => {
      restore = withConfig({
        smtpUrl: 'smtp://mail.example.com:587',
        publicUrl: 'https://xenon.example.com',
      });
      const send = sinon.stub(Container.get(EmailService), 'send').resolves();

      const r = await request(usersApp()).post('/users/u1/reset-link').set('Host', EVIL);

      expect(r.body).to.include({ emailed: true });
      expect(send.firstCall.args[0].text).to.include(
        `https://xenon.example.com/xenon/reset-password#${RAW}`,
      );
      expect(send.firstCall.args[0].text).to.not.include(EVIL);
    });

    it('without XENON_PUBLIC_URL, hands the link to the admin instead of emailing it', async () => {
      restore = withConfig({ smtpUrl: 'smtp://mail.example.com:587', publicUrl: undefined });
      const send = sinon.stub(Container.get(EmailService), 'send').resolves();

      const r = await request(usersApp()).post('/users/u1/reset-link');

      expect(r.status).to.equal(200);
      expect(r.body.emailed).to.equal(false);
      expect(r.body.link).to.match(new RegExp(`/xenon/reset-password#${RAW}$`));
      expect(send.called).to.equal(false);
    });
  });

  describe('resetLinkBase (XENON_PUBLIC_URL)', () => {
    // The variable is the server's address. The dashboard's own address,
    // with /xenon (README gives http://localhost:4723/xenon/), is taken too:
    // kept as given it made /xenon/xenon/reset-password, which the dashboard
    // routes to the sign-in page, losing the token.
    it('is the server address, with or without a trailing slash', () => {
      expect(resetLinkBase({ publicUrl: 'https://xenon.example.com' })).to.equal(
        'https://xenon.example.com',
      );
      expect(resetLinkBase({ publicUrl: 'https://xenon.example.com/' })).to.equal(
        'https://xenon.example.com',
      );
      expect(resetLinkBase({ publicUrl: 'http://lab-mac:4723' })).to.equal('http://lab-mac:4723');
    });

    for (const publicUrl of [
      'http://localhost:4723/xenon',
      'http://localhost:4723/xenon/',
      'http://localhost:4723/xenon//',
    ]) {
      it(`takes the dashboard's address too: ${publicUrl}`, () => {
        expect(resetLinkBase({ publicUrl })).to.equal('http://localhost:4723');
        expect(buildResetLink(String(resetLinkBase({ publicUrl })), 'TOK')).to.equal(
          'http://localhost:4723/xenon/reset-password#TOK',
        );
      });
    }

    // The dashboard loads its pages, scripts and API from /xenon on the
    // server's root, so it can't be served under another prefix: an address
    // with any other path is a mistake, and no link is sent rather than one
    // that can't open.
    it('is null for an address with any other path', () => {
      for (const publicUrl of [
        'https://lab.example.com/qa/',
        'https://lab.example.com/qa/xenon',
        'http://localhost:4723/xenon/login',
      ]) {
        expect(resetLinkBase({ publicUrl }), publicUrl).to.equal(null);
      }
    });

    it('is null when unset, or not an http(s) address', () => {
      for (const publicUrl of [
        undefined,
        '',
        '   ',
        'not a url',
        'ftp://x.example',
        'javascript:alert(1)',
      ]) {
        expect(resetLinkBase({ publicUrl }), String(publicUrl)).to.equal(null);
      }
    });

    it('is null for an address with a query or fragment, which would swallow the token', () => {
      expect(resetLinkBase({ publicUrl: 'https://x.example/?a=1' })).to.equal(null);
      expect(resetLinkBase({ publicUrl: 'https://x.example/#a' })).to.equal(null);
    });
  });

  describe('passwordResetMode', () => {
    it("is 'email' only with both SMTP and XENON_PUBLIC_URL", () => {
      expect(
        passwordResetMode({ smtpUrl: 'smtp://m:587', publicUrl: 'https://x.example' }),
      ).to.equal('email');
      expect(passwordResetMode({ smtpUrl: 'smtp://m:587' })).to.equal('admin');
      expect(passwordResetMode({ publicUrl: 'https://x.example' })).to.equal('admin');
    });
  });

  // The email said "1 hour" whatever XENON_RESET_TOKEN_TTL_MS was.
  describe('the email says how long the link really lasts', () => {
    const user = { email: 'u@x.local', name: 'U' };
    for (const [ms, words] of [
      [60 * 60 * 1000, '1 hour'],
      [30 * 60 * 1000, '30 minutes'],
      [2 * 60 * 60 * 1000, '2 hours'],
      [90 * 60 * 1000, '90 minutes'],
      [24 * 60 * 60 * 1000, '24 hours'],
      [60 * 1000, '1 minute'],
    ] as const) {
      it(`${words} for ${ms} ms`, () => {
        expect(resetEmail(user, 'https://x/l', ms).text).to.include(
          `This link expires in ${words}.`,
        );
      });
    }
  });
});
