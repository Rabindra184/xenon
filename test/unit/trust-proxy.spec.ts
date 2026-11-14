import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { applyTrustProxy, resolveTrustProxy } from '../../src/app/trustProxy';

/**
 * The sign-in limit counts callers by `req.ip`, which honours Express's
 * `trust proxy`. Behind a reverse proxy, without it, every sign-in counts
 * against the proxy's one address. `trustProxy` (or XENON_TRUST_PROXY) says
 * which proxies may name the caller.
 */
describe('trustProxy', () => {
  describe('resolveTrustProxy', () => {
    it('is not set when neither the option nor the variable is', () => {
      expect(resolveTrustProxy(undefined, undefined)).to.equal(undefined);
      expect(resolveTrustProxy('', '')).to.equal(undefined);
      expect(resolveTrustProxy('  ', undefined)).to.equal(undefined);
    });

    it('takes the option over the variable', () => {
      expect(resolveTrustProxy('loopback', '10.0.0.0/8')).to.equal('loopback');
      expect(resolveTrustProxy(undefined, '10.0.0.0/8')).to.equal('10.0.0.0/8');
    });

    it("reads Express's values: booleans, hop counts and address lists", () => {
      expect(resolveTrustProxy('true', undefined)).to.equal(true);
      expect(resolveTrustProxy('false', undefined)).to.equal(false);
      expect(resolveTrustProxy('1', undefined)).to.equal(1);
      expect(resolveTrustProxy(' loopback, 10.0.0.0/8 ', undefined)).to.equal(
        'loopback, 10.0.0.0/8',
      );
      expect(resolveTrustProxy(2, undefined)).to.equal(2);
    });
  });

  describe('applyTrustProxy', () => {
    const appAnswering = (option: unknown, env?: string) => {
      const app = express();
      const applied = applyTrustProxy(app, option, env);
      app.get('/ip', (req, res) => res.json({ ip: req.ip }));
      return { app, applied };
    };

    it('leaves req.ip the connecting address when nothing is trusted', async () => {
      const { app, applied } = appAnswering(undefined, undefined);
      expect(applied).to.equal(undefined);
      const res = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.9');
      expect(res.body.ip).to.not.equal('203.0.113.9');
    });

    it('makes req.ip the address a trusted proxy saw', async () => {
      const { app, applied } = appAnswering('loopback', undefined);
      expect(applied).to.equal('loopback');
      const res = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.9');
      expect(res.body.ip).to.equal('203.0.113.9');
    });

    it('takes XENON_TRUST_PROXY when the option is unset', async () => {
      const { app, applied } = appAnswering(undefined, '1');
      expect(applied).to.equal(1);
      const res = await request(app).get('/ip').set('X-Forwarded-For', '198.51.100.4');
      expect(res.body.ip).to.equal('198.51.100.4');
    });

    it("ignores a value Express can't use, leaving the setting off", async () => {
      const { app, applied } = appAnswering('not-an-address', undefined);
      expect(applied).to.equal(undefined);
      const res = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.9');
      expect(res.body.ip).to.not.equal('203.0.113.9');
    });
  });
});
