import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { createRouter } from '../../src/app/index';
import { config } from '../../src/config';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';

/**
 * `/xenon/mcp` as the plugin serves it, through the whole `/xenon` router:
 * no web page but this server's own may call it. The router's static files
 * carry a wildcard CORS policy, and with auth disabled no credential stands
 * between a page and every tool.
 */
describe('the MCP endpoint through the /xenon router: other origins', () => {
  let savedAuthDisabled: boolean;
  let app: express.Express;

  before(() => {
    app = express();
    app.use('/xenon', createRouter({ ...DefaultPluginArgs }));
  });

  beforeEach(() => {
    savedAuthDisabled = config.authDisabled;
    config.authDisabled = true;
  });

  afterEach(() => {
    config.authDisabled = savedAuthDisabled;
  });

  const toolsList = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

  it("doesn't answer another origin's preflight", async () => {
    const res = await request(app)
      .options('/xenon/mcp')
      .set('origin', 'https://evil.example')
      .set('access-control-request-method', 'POST')
      .set('access-control-request-headers', 'content-type');
    expect(res.status).to.equal(403);
    expect(res.headers).to.not.have.property('access-control-allow-origin');
    expect(res.headers).to.not.have.property('access-control-allow-methods');
  });

  it("refuses another origin's POST with auth disabled", async () => {
    const res = await request(app)
      .post('/xenon/mcp')
      .set('origin', 'https://evil.example')
      .set('accept', 'application/json, text/event-stream')
      .send(toolsList);
    expect(res.status).to.equal(403);
    expect(res.body).to.deep.equal({ error: 'forbidden_origin' });
    expect(res.headers).to.not.have.property('access-control-allow-origin');
  });

  it('serves an agent, which sends no origin, with no CORS headers', async () => {
    const res = await request(app)
      .post('/xenon/mcp')
      .set('accept', 'application/json, text/event-stream')
      .send(toolsList);
    expect(res.status).to.equal(200);
    expect(res.body.result.tools.map((t: { name: string }) => t.name)).to.include('xenon_lab_info');
    expect(res.headers).to.not.have.property('access-control-allow-origin');
  });
});
