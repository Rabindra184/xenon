import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { createRouter } from '../../src/app/index';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';

/**
 * The dashboard's pages can't be framed by any site, itself included. The
 * consent page is one Allow away from signing an agent in as the user, so a
 * page that framed it could get that click (clickjacking). The dashboard is
 * one index.html, and its router reaches the consent page from any entry
 * (a sign-in's `next`, a path in another letter case), so every page the
 * dashboard serves says so, not the consent path alone.
 */
describe('dashboard pages refuse to be framed', () => {
  const app = express();
  before(() => {
    app.use('/xenon', createRouter({ ...DefaultPluginArgs } as any));
  });

  for (const path of [
    '/xenon/oauth/consent/some-request',
    '/xenon/OAuth/Consent/x',
    '/xenon/overview',
    '/xenon/',
  ]) {
    it(`${path} answers X-Frame-Options DENY and frame-ancestors 'none'`, async () => {
      const res = await request(app).get(path);
      expect(res.headers['x-frame-options']).to.equal('DENY');
      const csp = String(res.headers['content-security-policy']);
      expect(csp).to.include("frame-ancestors 'none'");
      expect(csp).to.not.include("frame-ancestors 'self'");
      // The rest of the dashboard's policy is kept.
      expect(csp).to.include("default-src 'self'");
      expect(csp).to.include("script-src 'self' 'unsafe-inline'");
    });
  }
});
