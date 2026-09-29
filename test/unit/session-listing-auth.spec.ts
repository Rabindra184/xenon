import { expect } from 'chai';
import path from 'path';
import sinon from 'sinon';
import express4 from 'express';
import request from '../helpers/loopbackRequest';
import { COMMAND_AUTH_UNAVAILABLE_BODY } from '../../src/middleware/commandAuth';
import { CommandCallerVerifier } from '../../src/middleware/commandCaller';
import { registerCommandAuth, sessionListingPath } from '../../src/app/registerCommandAuth';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * Appium 3's session listing (`GET <basePath>/appium/sessions`) under
 * XENON_REQUIRE_COMMAND_AUTH.
 *
 * Appium answers it for anyone with every live session's id and capabilities,
 * which is the easiest way to find an id to use. With the setting on, the
 * answer is filtered: an override admin sees everything, a verified caller sees
 * the sessions they own, and a caller without valid credentials sees an empty
 * list in Appium's own shape. Appium still produces the listing; Xenon only
 * removes entries from it.
 *
 * The apps are built as Appium builds its own (middleware, routes, then the
 * plugin's updater), and the listing route records that it ran.
 */

function appiumExpress(): any {
  const appiumDir = path.dirname(require.resolve('appium/package.json'));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(require.resolve('express', { paths: [appiumDir] }));
}

const USERS: Record<string, { id: string; role: string; status: string }> = {
  alice: { id: 'alice', role: 'MEMBER', status: 'ACTIVE' },
  bob: { id: 'bob', role: 'MEMBER', status: 'ACTIVE' },
  carol: { id: 'carol', role: 'ADMIN', status: 'ACTIVE' },
  root: { id: 'root', role: 'SUPER_ADMIN', status: 'ACTIVE' },
};

// token -> [owner, scopes]
const KEYS: Record<string, [string, string]> = {
  'alice-token': ['alice', 'devices,sessions,read'],
  'bob-token': ['bob', 'devices,sessions,read'],
  'carol-ordinary': ['carol', 'devices,sessions,read'],
  'carol-admin': ['carol', 'admin,devices,sessions,read'],
};
const JWTS: Record<string, [string, string]> = {
  'alice-jwt': ['alice', 'devices,sessions,read'],
  'root-jwt': ['root', 'sessions'],
};

const OWNERS: Record<string, string | null> = {
  's-alice': 'alice',
  's-bob': 'bob',
  's-anon': null,
  's-alice-2': 'alice',
};

/** What Appium's getAppiumSessions answers: id, creation time, capabilities. */
const LISTING = [
  { id: 's-alice', created: 1, capabilities: { platformName: 'Android' } },
  { id: 's-bob', created: 2, capabilities: { platformName: 'iOS' } },
  { id: 's-anon', created: 3, capabilities: { platformName: 'Android' } },
  { id: 's-alice-2', created: 4, capabilities: { platformName: 'iOS' } },
];
const ALL_IDS = LISTING.map((s) => s.id);

const as = (token: string) => ({
  'x-xenon-access-key': `ak-${KEYS[token][0]}`,
  'x-xenon-token': token,
});
const bearer = (jwt: string) => ({ authorization: `Bearer ${jwt}` });
const idsOf = (res: request.Response) => (res.body.value as Array<{ id: string }>).map((s) => s.id);

const shapes: Array<[string, () => any]> = [
  ['Express 4', () => express4()],
  ['Express 5 (Appium 3)', () => appiumExpress()()],
];

describe('session listing under per-command auth (GET <basePath>/appium/sessions)', () => {
  it('is the listing route under the normalised base path', () => {
    expect(sessionListingPath('/wd/hub')).to.equal('/wd/hub/appium/sessions');
    expect(sessionListingPath('wd/hub/')).to.equal('/wd/hub/appium/sessions');
    expect(sessionListingPath('')).to.equal('/appium/sessions');
    expect(sessionListingPath(undefined)).to.equal('/appium/sessions');
  });

  for (const [shapeName, makeExpress] of shapes) {
    describe(shapeName, () => {
      let enabled: boolean;
      let authDisabled: boolean;
      let verifyKeyPair: sinon.SinonStub;
      let verifyBearer: sinon.SinonStub;
      let ownerOf: sinon.SinonStub;
      let ownersOf: sinon.SinonStub;
      let infos: string[];
      let warnings: string[];
      let errors: string[];
      /** What the listing route answers; a test may swap in an error. */
      let answer: { status: number; body: unknown };
      const loopback = loopbackServers();

      afterEach(() => loopback.closeAll());

      async function lab() {
        const ran: string[] = [];
        const app = makeExpress();
        app.use(express4.json());
        app.get('/wd/hub/appium/sessions', (_req: any, res: any) => {
          ran.push('getAppiumSessions');
          res.status(answer.status).json(answer.body);
        });
        app.get('/wd/hub/status', (_req: any, res: any) => {
          ran.push('getStatus');
          res.json({ value: { ready: true } });
        });
        const result = registerCommandAuth(
          app,
          { basePath: '/wd/hub' },
          {
            enabled: () => enabled,
            authDisabled: () => authDisabled,
            verifier: new CommandCallerVerifier({ verifyKeyPair, verifyBearer }),
            ownerOf,
            ownersOf,
            logger: {
              info: (m: string) => infos.push(m),
              warn: (m: string) => warnings.push(m),
              error: (m: string) => errors.push(m),
            },
          },
        );
        expect(result.placed, 'placed ahead of the routes').to.equal(true);
        // Only what requests log counts below; drop the registration's own line.
        infos.splice(0);
        return { app: await loopback.serve(app), ran };
      }

      beforeEach(() => {
        enabled = true;
        authDisabled = false;
        infos = [];
        warnings = [];
        errors = [];
        answer = { status: 200, body: { value: LISTING } };
        verifyKeyPair = sinon.stub().callsFake(async (accessKey: string, token: string) => {
          const key = KEYS[token];
          if (!key || accessKey !== `ak-${key[0]}`) return null;
          return {
            row: { id: `key-${token}`, userId: key[0], scopes: key[1], expiresAt: null },
            user: USERS[key[0]],
          };
        });
        verifyBearer = sinon.stub().callsFake(async (jwt: string) => {
          const t = JWTS[jwt];
          if (!t) return null;
          return { payload: { sub: t[0], scopes: t[1] }, user: USERS[t[0]] };
        });
        ownerOf = sinon.stub().callsFake(async (id: string) => (id in OWNERS ? OWNERS[id] : null));
        ownersOf = sinon
          .stub()
          .callsFake(
            async (ids: string[]) =>
              new Map(ids.map((id) => [id, id in OWNERS ? OWNERS[id] : null])),
          );
      });

      describe('who sees what', () => {
        it('shows the owner only the sessions they own', async () => {
          const { app, ran } = await lab();
          const res = await request(app).get('/wd/hub/appium/sessions').set(as('alice-token'));
          expect(res.status).to.equal(200);
          expect(res.headers['content-type']).to.equal('application/json; charset=utf-8');
          expect(res.body).to.deep.equal({ value: [LISTING[0], LISTING[3]] });
          expect(ran).to.deep.equal(['getAppiumSessions']);
        });

        it('decides every listed session with one owner lookup, not one per session', async () => {
          const { app } = await lab();
          await request(app).get('/wd/hub/appium/sessions').set(as('alice-token')).expect(200);
          expect(ownersOf.callCount).to.equal(1);
          expect(ownersOf.firstCall.args[0]).to.have.members(ALL_IDS);
          expect(ownerOf.called).to.equal(false);
        });

        it('shows the owner their sessions for a Bearer token too', async () => {
          const { app } = await lab();
          const res = await request(app).get('/wd/hub/appium/sessions').set(bearer('alice-jwt'));
          expect(idsOf(res)).to.deep.equal(['s-alice', 's-alice-2']);
        });

        it('shows another user only theirs', async () => {
          const { app } = await lab();
          const res = await request(app).get('/wd/hub/appium/sessions').set(as('bob-token'));
          expect(idsOf(res)).to.deep.equal(['s-bob']);
        });

        it('logs the filtering at info with the caller and the counts, never the credential', async () => {
          const { app } = await lab();
          await request(app).get('/wd/hub/appium/sessions').set(as('bob-token')).expect(200);
          expect(infos).to.have.length(1);
          expect(infos[0]).to.include('bob');
          expect(infos[0]).to.include('1 of 4');
          expect(infos[0]).not.to.include('bob-token');
          expect(warnings).to.deep.equal([]);
        });

        it('shows an admin-scoped key every session, without looking up owners', async () => {
          const { app } = await lab();
          const res = await request(app).get('/wd/hub/appium/sessions').set(as('carol-admin'));
          expect(res.body).to.deep.equal({ value: LISTING });
          expect(ownersOf.called || ownerOf.called).to.equal(false);
        });

        it('shows a SUPER_ADMIN every session', async () => {
          const { app } = await lab();
          const res = await request(app).get('/wd/hub/appium/sessions').set(bearer('root-jwt'));
          expect(idsOf(res)).to.deep.equal(ALL_IDS);
        });

        it("shows an ADMIN's ordinary key only their own sessions, here none", async () => {
          const { app } = await lab();
          const res = await request(app).get('/wd/hub/appium/sessions').set(as('carol-ordinary'));
          expect(res.status).to.equal(200);
          expect(res.body).to.deep.equal({ value: [] });
        });

        it('never shows a session nobody owns to anyone but an override admin', async () => {
          const { app } = await lab();
          for (const who of ['alice-token', 'bob-token', 'carol-ordinary']) {
            const res = await request(app).get('/wd/hub/appium/sessions').set(as(who));
            expect(idsOf(res), who).not.to.include('s-anon');
          }
          const admin = await request(app).get('/wd/hub/appium/sessions').set(as('carol-admin'));
          expect(idsOf(admin)).to.include('s-anon');
        });
      });

      describe('callers without valid credentials', () => {
        it("get an empty list in Appium's normal shape, with no lookups at all", async () => {
          const { app, ran } = await lab();
          const res = await request(app).get('/wd/hub/appium/sessions');
          expect(res.status).to.equal(200);
          expect(res.headers['content-type']).to.equal('application/json; charset=utf-8');
          expect(res.text).to.equal('{"value":[]}');
          expect(ran).to.deep.equal(['getAppiumSessions']);
          expect(verifyKeyPair.called || verifyBearer.called).to.equal(false);
          expect(ownersOf.called || ownerOf.called).to.equal(false);
          expect(warnings).to.have.length(1);
          expect(warnings[0]).to.include('no credentials');
        });

        it('get an empty list for credentials that do not verify, logged without the secret', async () => {
          const { app } = await lab();
          const res = await request(app)
            .get('/wd/hub/appium/sessions')
            .set({ 'x-xenon-access-key': 'ak-alice', 'x-xenon-token': 'guessed' });
          expect(res.status).to.equal(200);
          expect(res.body).to.deep.equal({ value: [] });
          expect(ownersOf.called).to.equal(false);
          expect(warnings).to.have.length(1);
          expect(warnings[0]).to.include('invalid credentials');
          expect(warnings[0]).not.to.include('guessed');
        });

        it('get the same answer as when no session is running', async () => {
          const { app } = await lab();
          const filtered = await request(app).get('/wd/hub/appium/sessions');
          answer = { status: 200, body: { value: [] } };
          const empty = await request(app).get('/wd/hub/appium/sessions').set(as('carol-admin'));
          expect(filtered.status).to.equal(empty.status);
          expect(filtered.headers['content-type']).to.equal(empty.headers['content-type']);
          expect(filtered.text).to.equal(empty.text);
        });

        it('are filtered on the path in another letter case and with a trailing slash', async () => {
          const { app, ran } = await lab();
          for (const url of ['/WD/HUB/APPIUM/SESSIONS', '/wd/hub/appium/sessions/']) {
            const res = await request(app).get(url);
            expect(res.status, url).to.equal(200);
            expect(res.body, url).to.deep.equal({ value: [] });
          }
          expect(ran).to.deep.equal(['getAppiumSessions', 'getAppiumSessions']);
        });
      });

      describe('what it leaves alone', () => {
        it('does nothing at all when the setting is off (the default)', async () => {
          enabled = false;
          const { app } = await lab();
          const res = await request(app).get('/wd/hub/appium/sessions');
          expect(res.body).to.deep.equal({ value: LISTING });
          expect(verifyKeyPair.called || verifyBearer.called).to.equal(false);
          expect(ownersOf.called || ownerOf.called).to.equal(false);
          expect(infos.concat(warnings, errors)).to.deep.equal([]);
        });

        it('does nothing when auth is disabled, even with the setting on', async () => {
          authDisabled = true;
          const { app } = await lab();
          const res = await request(app).get('/wd/hub/appium/sessions');
          expect(res.body).to.deep.equal({ value: LISTING });
          expect(ownersOf.called).to.equal(false);
        });

        it("passes Appium's error answer through untouched (session_discovery not enabled)", async () => {
          answer = {
            status: 400,
            body: {
              value: {
                error: 'invalid argument',
                message: 'Potentially insecure feature session_discovery has not been enabled',
                stacktrace: '',
              },
            },
          };
          const { app } = await lab();
          for (const headers of [{}, as('alice-token')]) {
            const res = await request(app).get('/wd/hub/appium/sessions').set(headers);
            expect(res.status).to.equal(400);
            expect(res.body).to.deep.equal(answer.body);
          }
          expect(ownersOf.called).to.equal(false);
        });

        it('leaves other requests alone', async () => {
          const { app, ran } = await lab();
          const res = await request(app).get('/wd/hub/status');
          expect(res.body).to.deep.equal({ value: { ready: true } });
          expect(ran).to.deep.equal(['getStatus']);
          expect(warnings).to.deep.equal([]);
        });
      });

      describe('failing closed', () => {
        it('answers 503 when the credential check fails, before the listing runs', async () => {
          verifyKeyPair.rejects(new Error('database is locked'));
          const { app, ran } = await lab();
          const res = await request(app).get('/wd/hub/appium/sessions').set(as('alice-token'));
          expect(res.status).to.equal(503);
          expect(res.body).to.deep.equal(COMMAND_AUTH_UNAVAILABLE_BODY);
          expect(ran).to.deep.equal([]);
          expect(errors).to.have.length(1);
          expect(errors[0]).to.include('database is locked');
        });

        it('answers 503 when the owner lookup fails, never the unfiltered list', async () => {
          ownersOf.rejects(new Error('database is locked\nSELECT secret FROM ...'));
          const { app } = await lab();
          const res = await request(app).get('/wd/hub/appium/sessions').set(as('alice-token'));
          expect(res.status).to.equal(503);
          expect(res.body).to.deep.equal(COMMAND_AUTH_UNAVAILABLE_BODY);
          expect(res.text).not.to.include('s-bob');
          expect(errors).to.have.length(1);
          expect(errors[0]).to.include('database is locked');
          expect(errors[0]).not.to.include('SELECT');
        });

        it('drops a listed entry it cannot attribute rather than showing it', async () => {
          answer = { status: 200, body: { value: [LISTING[0], { created: 5 }, 'junk'] } };
          const { app } = await lab();
          const res = await request(app).get('/wd/hub/appium/sessions').set(as('alice-token'));
          expect(res.body).to.deep.equal({ value: [LISTING[0]] });
        });
      });
    });
  }
});
