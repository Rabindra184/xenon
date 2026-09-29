import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';
import * as pluginArgs from '../../src/data-service/pluginArgs';
import { createRouter } from '../../src/app/index';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserService } from '../../src/services/UserService';
import { UserSessionService } from '../../src/services/UserSessionService';

/**
 * GET /xenon/api/cliArgs returns the Appium arguments the server was started
 * with. They can carry a database URL with its password, AI provider keys and
 * cloud credentials. It answered any logged-in caller, unredacted. It is now
 * admin-only, like /processes, and redacts secret-looking values the way the
 * startup log does.
 *
 * Driven through the real /xenon/api stack (createRouter + authMiddleware),
 * so the guard is proved where it is mounted.
 */
describe('GET /xenon/api/cliArgs', () => {
  const DB_URL = 'postgresql://xenon:hunter2-db@db.internal:5432/xenon';
  const GEMINI_KEY = `AIza${'x'.repeat(35)}`;
  const OPENAI_KEY = `sk-${'a1B2'.repeat(10)}`;
  const CLOUD_KEY = 'bs-cloud-secret';

  const STORED = [
    {
      port: 4723,
      plugin: {
        xenon: {
          platform: 'android',
          maxSessions: 4,
          databaseUrl: DB_URL,
          geminiApiKey: GEMINI_KEY,
          // A key-like value under a key that isn't secret-sounding.
          aiBaseUrl: `https://llm.internal/v1?key=${OPENAI_KEY}`,
          cloud: { cloudName: 'browserstack', apiKey: CLOUD_KEY },
        },
      },
      // The flat spelling the startup log shows.
      plugin_xenon_database_url: DB_URL,
    },
  ];

  const USERS: Record<string, { id: string; role: string; status: string }> = {
    'u-member': { id: 'u-member', role: 'MEMBER', status: 'ACTIVE' },
    'u-admin': { id: 'u-admin', role: 'ADMIN', status: 'ACTIVE' },
  };
  const SESSIONS: Record<string, { id: string; userId: string }> = {
    'sess-member': { id: 'sess-member', userId: 'u-member' },
    'sess-admin': { id: 'sess-admin', userId: 'u-admin' },
  };

  let savedAuthDisabled: boolean;
  let load: sinon.SinonStub;
  let app: express.Express;

  before(() => {
    app = express();
    app.use('/xenon', createRouter({ bindHostOrIp: '127.0.0.1', enableDashboard: true } as any));
  });

  beforeEach(() => {
    savedAuthDisabled = config.authDisabled;
    config.authDisabled = false;
    // Stub the container's own instances, so sinon.restore() puts them back.
    sinon
      .stub(Container.get(UserSessionService), 'resolve')
      .callsFake((async (id: string) => SESSIONS[id] ?? null) as any);
    sinon
      .stub(Container.get(UserService), 'findById')
      .callsFake((async (id: string) => USERS[id] ?? null) as any);
    sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);
    load = sinon
      .stub(pluginArgs, 'getCLIArgs')
      .callsFake(async () => JSON.parse(JSON.stringify(STORED)));
  });

  afterEach(() => {
    sinon.restore();
    config.authDisabled = savedAuthDisabled;
  });

  const asCookie = (sessionId: string) =>
    request(app).get('/xenon/api/cliArgs').set('Cookie', `xenon_dashboard_session=${sessionId}`);

  function asApiKey(scopes: string, ownerId: string) {
    sinon.stub(Container.get(ApiKeyService), 'verifyPair').resolves({
      id: 'key-1',
      name: 'ci',
      keyHash: '',
      scopes,
      rateLimit: 100,
      revokedAt: null,
      expiresAt: null,
      userId: ownerId,
      teamId: null,
    } as any);
    return request(app)
      .get('/xenon/api/cliArgs')
      .set('x-xenon-access-key', 'ak')
      .set('x-xenon-token', 'tok');
  }

  it('refuses a member with 403, before reading the stored arguments', async () => {
    const r = await asCookie('sess-member');
    expect(r.status).to.equal(403);
    expect(r.text).to.not.include('hunter2-db');
    expect(load.called).to.equal(false);
  });

  it("refuses an admin's API key that lacks the admin scope", async () => {
    const r = await asApiKey('devices,sessions,read', 'u-admin');
    expect(r.status).to.equal(403);
    expect(r.text).to.not.include('hunter2-db');
    expect(load.called).to.equal(false);
  });

  it('gives an admin the arguments with secret-looking values redacted', async () => {
    const r = await asCookie('sess-admin');
    expect(r.status).to.equal(200);
    for (const secret of ['hunter2-db', GEMINI_KEY, OPENAI_KEY, CLOUD_KEY]) {
      expect(r.text).to.not.include(secret);
    }
    const [args] = r.body;
    expect(args.plugin.xenon.databaseUrl).to.equal('***REDACTED***');
    expect(args.plugin_xenon_database_url).to.equal('***REDACTED***');
    expect(args.plugin.xenon.geminiApiKey).to.equal('***REDACTED***');
    expect(args.plugin.xenon.cloud.apiKey).to.equal('***REDACTED***');
    expect(args.plugin.xenon.aiBaseUrl).to.equal('https://llm.internal/v1?key=***REDACTED***');
    // Everything else is still there.
    expect(args.port).to.equal(4723);
    expect(args.plugin.xenon.platform).to.equal('android');
    expect(args.plugin.xenon.maxSessions).to.equal(4);
    expect(args.plugin.xenon.cloud.cloudName).to.equal('browserstack');
  });

  it('gives an admin-scoped API key the same redacted arguments', async () => {
    const r = await asApiKey('admin', 'u-admin');
    expect(r.status).to.equal(200);
    expect(r.text).to.not.include('hunter2-db');
    expect(r.body[0].plugin.xenon.databaseUrl).to.equal('***REDACTED***');
  });
});
