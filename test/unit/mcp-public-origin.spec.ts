import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { mcpResourceUrl, publicOrigin } from '../../src/mcp/publicOrigin';
import { config } from '../../src/config';

/**
 * How the hub names itself to agents: in the 401 challenge, both sign-in
 * metadata documents and the OAuth `resource`. XENON_PUBLIC_URL's origin when
 * it is set; else the request's scheme and host, and a reverse proxy's
 * forwarded ones only when `trust proxy` says the proxy may be believed.
 */
describe('publicOrigin and mcpResourceUrl', () => {
  let savedPublicUrl: string | undefined;

  beforeEach(() => {
    savedPublicUrl = config.publicUrl;
    config.publicUrl = undefined;
  });

  afterEach(() => {
    config.publicUrl = savedPublicUrl;
  });

  function appWith(trustProxy?: unknown): express.Express {
    const app = express();
    if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
    app.get('/whoami', (req, res) =>
      res.json({ origin: publicOrigin(req), resource: mcpResourceUrl(req) }),
    );
    return app;
  }

  it('uses XENON_PUBLIC_URL when set', async () => {
    config.publicUrl = 'https://xenon.example.com/xenon/';
    const res = await request(appWith('loopback'))
      .get('/whoami')
      .set('host', 'lab-mac:4723')
      .set('x-forwarded-host', 'proxy.example.net')
      .set('x-forwarded-proto', 'http');
    expect(res.body).to.deep.equal({
      origin: 'https://xenon.example.com',
      resource: 'https://xenon.example.com/xenon/mcp',
    });
  });

  it('names the request host, port included, on plain HTTP', async () => {
    const res = await request(appWith()).get('/whoami').set('host', 'lab-mac:4723');
    expect(res.body).to.deep.equal({
      origin: 'http://lab-mac:4723',
      resource: 'http://lab-mac:4723/xenon/mcp',
    });
  });

  it('ignores X-Forwarded-Host and -Proto without trustProxy', async () => {
    const res = await request(appWith())
      .get('/whoami')
      .set('host', 'lab-mac:4723')
      .set('x-forwarded-host', 'xenon.example.com')
      .set('x-forwarded-proto', 'https');
    expect(res.body.origin).to.equal('http://lab-mac:4723');
  });

  it('ignores them when the proxy that sent them is not trusted', async () => {
    const res = await request(appWith('10.0.0.1'))
      .get('/whoami')
      .set('host', 'lab-mac:4723')
      .set('x-forwarded-host', 'xenon.example.com')
      .set('x-forwarded-proto', 'https');
    expect(res.body.origin).to.equal('http://lab-mac:4723');
  });

  it('uses them with trustProxy', async () => {
    const res = await request(appWith('loopback'))
      .get('/whoami')
      .set('host', 'lab-mac:4723')
      .set('x-forwarded-host', 'xenon.example.com')
      .set('x-forwarded-proto', 'https');
    expect(res.body).to.deep.equal({
      origin: 'https://xenon.example.com',
      resource: 'https://xenon.example.com/xenon/mcp',
    });
  });

  it('takes the first of several forwarded hosts, and keeps its port', async () => {
    const res = await request(appWith(true))
      .get('/whoami')
      .set('host', 'lab-mac:4723')
      .set('x-forwarded-host', 'xenon.example.com:8443, inner.example.net')
      .set('x-forwarded-proto', 'https, http');
    expect(res.body.origin).to.equal('https://xenon.example.com:8443');
  });
});
