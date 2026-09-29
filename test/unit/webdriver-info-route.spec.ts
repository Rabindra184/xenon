import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import { config } from '../../src/config';
import { createRouter } from '../../src/app/index';
import { PluginContext } from '../../src/PluginContext';

/**
 * GET /xenon/api/webdriver: where this server's WebDriver API lives. A hub
 * asks a node before sending it a session or a command, because a phone's
 * `host` names only the node's origin and the two need not share a base path.
 * The hub holds no credentials for the node, so the answer needs no login;
 * the base path is part of every client's URL anyway.
 *
 * Driven through the real /xenon/api stack (createRouter + authMiddleware).
 */
describe('GET /xenon/api/webdriver', () => {
  let app: express.Express;
  let savedAuthDisabled: boolean;
  let savedBasePath: string;

  before(() => {
    app = express();
    app.use('/xenon', createRouter({ bindHostOrIp: '127.0.0.1', enableDashboard: false } as any));
  });

  beforeEach(() => {
    savedAuthDisabled = config.authDisabled;
    config.authDisabled = false;
    savedBasePath = Container.get(PluginContext).nodeBasePath;
  });

  afterEach(() => {
    config.authDisabled = savedAuthDisabled;
    Container.get(PluginContext).nodeBasePath = savedBasePath;
  });

  it("answers this server's base path, normalised as Appium does, without a login", async () => {
    Container.get(PluginContext).nodeBasePath = 'wd/hub/';
    const res = await request(app).get('/xenon/api/webdriver');
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ basePath: '/wd/hub' });
  });

  it("answers Appium 3's default, no base path, as an empty one", async () => {
    Container.get(PluginContext).nodeBasePath = '';
    const res = await request(app).get('/xenon/api/webdriver');
    expect(res.body).to.deep.equal({ basePath: '' });
  });

  it('while the rest of /xenon/api still needs one', async () => {
    const res = await request(app).get('/xenon/api/cliArgs');
    expect(res.status).to.equal(401);
  });
});
