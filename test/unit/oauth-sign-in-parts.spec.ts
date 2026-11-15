import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import { TooManyRequestsError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import request from '../helpers/loopbackRequest';
import { addressKey, requestLimiter } from '../../src/services/oauth/callerAddress';
import {
  PENDING_AUTHORIZATION_TTL_MS,
  PendingAuthorizations,
} from '../../src/services/oauth/pendingAuthorizations';
import { AuthCodes } from '../../src/services/oauth/authCodes';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

/** The pieces the agent sign-in routes are built from (src/app/routers/oauth.ts). */
describe('agent sign-in parts', () => {
  describe('addressKey', () => {
    it('keeps an IPv4 address as it is', () => {
      expect(addressKey('198.51.100.7')).to.equal('198.51.100.7');
    });

    it('folds an IPv4-mapped IPv6 address to its IPv4 address', () => {
      expect(addressKey('::ffff:198.51.100.7')).to.equal('198.51.100.7');
      expect(addressKey('::FFFF:c633:6407')).to.equal('198.51.100.7');
    });

    it('counts any other IPv6 address by its /64', () => {
      expect(addressKey('2001:db8:1:2:3:4:5:6')).to.equal('2001:db8:1:2::/64');
      expect(addressKey('2001:db8:1:2::9')).to.equal('2001:db8:1:2::/64');
      expect(addressKey('2001:0db8:0001:0002:ffff::1')).to.equal('2001:db8:1:2::/64');
      expect(addressKey('2001:db8::1')).to.equal('2001:db8:0:0::/64');
      expect(addressKey('::1')).to.equal('0:0:0:0::/64');
      expect(addressKey('fe80::1%en0')).to.equal('fe80:0:0:0::/64');
      expect(addressKey('64:ff9b::198.51.100.7')).to.equal('64:ff9b:0:0::/64');
    });

    it('keeps anything else as given', () => {
      expect(addressKey(undefined)).to.equal('');
      expect(addressKey('')).to.equal('');
      expect(addressKey('not-an-address')).to.equal('not-an-address');
    });
  });

  describe('requestLimiter', () => {
    function appWith(max: number, windowMs = 60_000) {
      const app = express();
      app.set('trust proxy', 'loopback');
      app.get('/', requestLimiter({ windowMs, max, message: 'slow down' }), (_req, res) =>
        res.json({ ok: true }),
      );
      return app;
    }

    it('lets max requests through per address, then answers 429 too_many_requests', async () => {
      const app = appWith(2);
      const from = (xff: string) => request(app).get('/').set('x-forwarded-for', xff);
      expect((await from('192.0.2.1')).status).to.equal(200);
      expect((await from('::ffff:192.0.2.1')).status).to.equal(200);
      const refused = await from('192.0.2.1');
      expect(refused.status).to.equal(429);
      expect(refused.body).to.deep.equal({
        error: 'too_many_requests',
        error_description: 'slow down',
      });
      expect(Number(refused.headers['retry-after'])).to.be.within(1, 60);
      expect((await from('192.0.2.2')).status).to.equal(200);
    });

    it('starts counting again once the window is over', async () => {
      const app = appWith(1, 50);
      const from = () => request(app).get('/').set('x-forwarded-for', '192.0.2.9');
      expect((await from()).status).to.equal(200);
      expect((await from()).status).to.equal(429);
      await new Promise((r) => setTimeout(r, 70));
      expect((await from()).status).to.equal(200);
    });
  });

  describe('PendingAuthorizations', () => {
    const input = {
      clientId: 'c1',
      clientName: 'Agent',
      redirectUri: 'http://127.0.0.1:5000/cb',
      codeChallenge: CHALLENGE,
      scopes: ['xenon:devices:read'],
      state: 's',
      resource: 'http://lab-mac:4723/xenon/mcp',
    };

    it('keeps a request for 10 minutes', () => {
      const store = new PendingAuthorizations();
      let now = 1_000_000;
      store.now = () => now;
      const pending = store.add(input);
      expect(pending.id).to.match(/^[A-Za-z0-9_-]{32}$/);
      expect(store.get(pending.id)?.clientId).to.equal('c1');
      now += PENDING_AUTHORIZATION_TTL_MS - 1;
      expect(store.get(pending.id)).to.not.equal(undefined);
      now += 1;
      expect(store.get(pending.id)).to.equal(undefined);
      expect(store.take(pending.id)).to.equal(undefined);
    });

    it('answers a request once; one put back can be answered again while in time', () => {
      const store = new PendingAuthorizations();
      let now = 1_000_000;
      store.now = () => now;
      const pending = store.add(input);
      const taken = store.take(pending.id)!;
      expect(store.take(pending.id)).to.equal(undefined);
      store.putBack(taken);
      expect(store.take(pending.id)?.id).to.equal(pending.id);
      now += PENDING_AUTHORIZATION_TTL_MS;
      store.putBack(taken);
      expect(store.get(pending.id)).to.equal(undefined);
    });

    it('holds at most 1,000 waiting requests, counting only those still in time', () => {
      const store = new PendingAuthorizations();
      let now = 1_000_000;
      store.now = () => now;
      for (let i = 0; i < 1000; i++) store.add(input);
      expect(() => store.add(input)).to.throw(TooManyRequestsError);
      now += PENDING_AUTHORIZATION_TTL_MS;
      expect(() => store.add(input)).to.not.throw();
    });
  });

  describe('AuthCodes', () => {
    it('a full code store throws the typed too_many_requests error', () => {
      const codes = new AuthCodes();
      const code = {
        userId: 'u',
        clientId: 'c',
        redirectUri: 'http://127.0.0.1/cb',
        codeChallenge: CHALLENGE,
        scopes: [],
        resource: 'http://lab-mac:4723/xenon/mcp',
      };
      for (let i = 0; i < 10_000; i++) codes.issue(code);
      let thrown: unknown;
      try {
        codes.issue(code);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).to.be.instanceOf(TooManyRequestsError);
      expect((thrown as TooManyRequestsError).toResponseObject().error).to.equal(
        'too_many_requests',
      );
    });
  });
});
