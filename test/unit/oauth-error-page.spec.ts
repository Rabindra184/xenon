import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { readableErrorsForBrowsers } from '../../src/app/routers/oauthErrorPage';
import { DOCUMENT_UNREACHABLE } from '../../src/services/oauth/clientStore';

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

/** An app whose one route answers `status` with `body` as JSON, behind the wrapper. */
function appAnswering(status: number, body: unknown, headers: Record<string, string> = {}) {
  const app = express();
  app.get('/authorize', readableErrorsForBrowsers, (_req, res) => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    res.status(status).json(body);
  });
  return app;
}

/**
 * The sign-in's authorize page is opened by a person in a browser. Its errors
 * are read there, so a browser gets a page, and every other client the JSON
 * it always got.
 */
describe('the sign-in error page', () => {
  it('gives a browser the network page, with the switch for admins', async () => {
    const res = await request(
      appAnswering(400, { error: 'invalid_client', error_description: DOCUMENT_UNREACHABLE }),
    )
      .get('/authorize')
      .set('accept', BROWSER);
    expect(res.status).to.equal(400);
    expect(res.headers['content-type']).to.match(/^text\/html/);
    expect(res.text).to.contain("Xenon couldn't read this agent's details");
    expect(res.text).to.contain('start the sign-in again from your agent');
    expect(res.text).to.contain('XENON_MCP_CLIENT_DOCUMENTS=off');
    expect(res.text).to.contain('Error: invalid_client (400)');
    expect(res.headers['cache-control']).to.equal('no-store');
    expect(res.headers['x-frame-options']).to.equal('DENY');
    expect(res.headers['content-security-policy']).to.contain("frame-ancestors 'none'");
  });

  it('leaves JSON to a client that asks for it, or says nothing', async () => {
    const body = { error: 'invalid_client', error_description: DOCUMENT_UNREACHABLE };
    const asked = await request(appAnswering(400, body))
      .get('/authorize')
      .set('accept', 'application/json');
    const silent = await request(appAnswering(400, body)).get('/authorize');
    for (const res of [asked, silent]) {
      expect(res.status).to.equal(400);
      expect(res.headers['content-type']).to.match(/^application\/json/);
      expect(res.body).to.deep.equal(body);
    }
  });

  it('escapes what it shows', async () => {
    const res = await request(
      appAnswering(400, {
        error: 'invalid_request',
        error_description: '<script>alert(1)</script>',
      }),
    )
      .get('/authorize')
      .set('accept', BROWSER);
    expect(res.text).to.not.match(/<script/i);
    expect(res.text).to.contain('&lt;script&gt;');
  });

  it('keeps the status and Retry-After of a 429', async () => {
    const res = await request(
      appAnswering(
        429,
        { error: 'too_many_requests', error_description: 'Too many sign-ins are waiting' },
        { 'Retry-After': '60' },
      ),
    )
      .get('/authorize')
      .set('accept', BROWSER);
    expect(res.status).to.equal(429);
    expect(res.headers['retry-after']).to.equal('60');
    expect(res.text).to.contain('Too many sign-ins right now');
    expect(res.text).to.contain('Error: too_many_requests (429)');
  });

  it('shows any other error under a general title', async () => {
    const res = await request(
      appAnswering(400, {
        error: 'invalid_request',
        error_description: 'response_type must be code',
      }),
    )
      .get('/authorize')
      .set('accept', BROWSER);
    expect(res.text).to.contain("This sign-in can't continue");
    expect(res.text).to.contain('response_type must be code');
  });

  it('passes a successful JSON answer through', async () => {
    const res = await request(appAnswering(200, { ok: true }))
      .get('/authorize')
      .set('accept', BROWSER);
    expect(res.headers['content-type']).to.match(/^application\/json/);
    expect(res.body).to.deep.equal({ ok: true });
  });

  it('has no script and links nowhere off the hub', async () => {
    const bodies = [
      [400, { error: 'invalid_client', error_description: DOCUMENT_UNREACHABLE }],
      [429, { error: 'too_many_requests', error_description: 'x' }],
      [400, { error: 'invalid_request' }],
    ] as const;
    for (const [status, body] of bodies) {
      const res = await request(appAnswering(status, body))
        .get('/authorize')
        .set('accept', BROWSER);
      expect(res.text).to.not.match(/<script/i);
      expect(res.text).to.not.match(/href="(?!\/)/);
    }
  });
});
