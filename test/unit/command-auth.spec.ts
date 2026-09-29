import { expect } from 'chai';
import path from 'path';
import sinon from 'sinon';
import express4 from 'express';
import request from '../helpers/loopbackRequest';
import {
  COMMAND_AUTH_UNAVAILABLE_BODY,
  UNKNOWN_SESSION_BODY,
  commandAuthEnabled,
} from '../../src/middleware/commandAuth';
import { CommandCallerVerifier } from '../../src/middleware/commandCaller';
import { loopbackServers } from '../helpers/loopbackServer';
import {
  normalizeBasePath,
  registerCommandAuth,
  sessionCommandPath,
} from '../../src/app/registerCommandAuth';

/**
 * Per-command auth for WebDriver session commands (XENON_REQUIRE_COMMAND_AUTH).
 *
 * Every request under <basePath>/session/:sessionId must carry the credentials
 * REST accepts, from the session's owner or an override admin. A refusal is
 * byte-for-byte WebDriver's unknown-session answer, so a caller cannot tell a
 * session they may not use from one that does not exist.
 *
 * The apps here are built the way Appium builds its own: middleware, then the
 * routes, and only then the plugin's updater (registerCommandAuth). Each route
 * records that it ran, which is how the tests show the check ran first.
 */

const EXACT_UNKNOWN_SESSION =
  '{"value":{"error":"invalid session id","message":"A session is either terminated or not started","stacktrace":""}}';

function appiumDir() {
  return path.dirname(require.resolve('appium/package.json'));
}

function appiumExpress(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(require.resolve('express', { paths: [appiumDir()] }));
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
  's-anon': null, // created without credentials
};

const as = (token: string) => ({
  'x-xenon-access-key': `ak-${KEYS[token][0]}`,
  'x-xenon-token': token,
});
const bearer = (jwt: string) => ({ authorization: `Bearer ${jwt}` });

const shapes: Array<[string, () => any]> = [
  ['Express 4', () => express4()],
  ['Express 5 (Appium 3)', () => appiumExpress()()],
];

describe('per-command auth (XENON_REQUIRE_COMMAND_AUTH)', () => {
  describe('the setting', () => {
    it('is read exactly like XENON_REQUIRE_SESSION_TOKEN', () => {
      for (const v of ['1', 'true', 'YES', 'On']) {
        expect(commandAuthEnabled({ XENON_REQUIRE_COMMAND_AUTH: v } as any)).to.equal(true);
      }
      for (const v of [undefined, '', '0', 'false', 'off', 'enabled']) {
        expect(commandAuthEnabled({ XENON_REQUIRE_COMMAND_AUTH: v } as any)).to.equal(false);
      }
    });

    it('is off by default', () => {
      expect(commandAuthEnabled({} as any)).to.equal(false);
    });
  });

  describe('the base path', () => {
    it("is normalised exactly as Appium's own normalizeBasePath does", () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const baseDriver = require(require.resolve('@appium/base-driver', { paths: [appiumDir()] }));
      for (const raw of ['', '/', 'wd/hub', '/wd/hub', '/wd/hub/', 'wd/hub/', '/a/b/c']) {
        expect(normalizeBasePath(raw), JSON.stringify(raw)).to.equal(
          baseDriver.normalizeBasePath(raw),
        );
      }
    });

    it('treats a missing base path as none', () => {
      expect(sessionCommandPath(undefined)).to.equal('/session/:sessionId');
      expect(sessionCommandPath('/wd/hub')).to.equal('/wd/hub/session/:sessionId');
    });
  });

  describe('the refusal', () => {
    it("is WebDriver's unknown-session answer, byte for byte", () => {
      expect(JSON.stringify(UNKNOWN_SESSION_BODY)).to.equal(EXACT_UNKNOWN_SESSION);
    });

    it("matches Appium 3's own NoSuchDriverError in status, error and message", () => {
      // The error Appium throws when a session command names a session it does
      // not have, rendered by Appium's own W3C error mapping.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const baseDriver = require(require.resolve('@appium/base-driver', { paths: [appiumDir()] }));
      const [status, body] = baseDriver.getResponseForW3CError(
        new baseDriver.errors.NoSuchDriverError(),
      );
      expect(status).to.equal(404);
      expect(UNKNOWN_SESSION_BODY.value.error).to.equal(body.value.error);
      expect(UNKNOWN_SESSION_BODY.value.message).to.equal(body.value.message);
      expect(Object.keys(UNKNOWN_SESSION_BODY.value)).to.deep.equal(Object.keys(body.value));
    });

    it('a lookup failure answers a WebDriver-shaped unknown error', () => {
      expect(COMMAND_AUTH_UNAVAILABLE_BODY.value.error).to.equal('unknown error');
      expect(COMMAND_AUTH_UNAVAILABLE_BODY.value.stacktrace).to.equal('');
    });
  });

  for (const [shapeName, makeExpress] of shapes) {
    describe(shapeName, () => {
      let enabled: boolean;
      let authDisabled: boolean;
      let verifyKeyPair: sinon.SinonStub;
      let verifyBearer: sinon.SinonStub;
      let ownerOf: sinon.SinonStub;
      let warnings: string[];
      let errors: string[];
      const loopback = loopbackServers();

      afterEach(() => loopback.closeAll());

      /** Appium's shape: its middleware, its routes, then the plugin's updater. */
      async function lab(opts: { basePath?: string; routePrefix?: string } = {}) {
        const basePath = opts.basePath ?? '/wd/hub';
        const prefix = opts.routePrefix ?? '/wd/hub';
        const ran: string[] = [];
        const app = makeExpress();
        app.use(express4.json());
        const route = (name: string) => (req: any, res: any) => {
          ran.push(name);
          res.json({ value: req.params.sessionId ?? null });
        };
        app.post(`${prefix}/session`, route('createSession'));
        app.get(`${prefix}/session/:sessionId`, route('getSession'));
        app.delete(`${prefix}/session/:sessionId`, route('deleteSession'));
        app.get(`${prefix}/session/:sessionId/url`, route('getUrl'));
        app.post(`${prefix}/session/:sessionId/element`, route('findElement'));
        app.get(`${prefix}/status`, route('getStatus'));
        app.get(`${prefix}/appium/sessions`, route('getAppiumSessions'));
        app.get('/xenon/api/devices', route('xenonApi'));

        const result = registerCommandAuth(
          app,
          { basePath },
          {
            enabled: () => enabled,
            authDisabled: () => authDisabled,
            verifier: new CommandCallerVerifier({ verifyKeyPair, verifyBearer }),
            ownerOf,
            logger: {
              info: () => undefined,
              warn: (m: string) => warnings.push(m),
              error: (m: string) => errors.push(m),
            },
          },
        );
        expect(result.placed, 'placed ahead of the routes').to.equal(true);
        return { app: await loopback.serve(app), ran };
      }

      beforeEach(() => {
        enabled = true;
        authDisabled = false;
        warnings = [];
        errors = [];
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
      });

      async function expectRefused(res: request.Response) {
        expect(res.status).to.equal(404);
        expect(res.headers['content-type']).to.equal('application/json; charset=utf-8');
        expect(res.text).to.equal(EXACT_UNKNOWN_SESSION);
      }

      describe('who may drive a session', () => {
        it("lets the owner's key through to the route", async () => {
          const { app, ran } = await lab();
          const res = await request(app).get('/wd/hub/session/s-alice/url').set(as('alice-token'));
          expect(res.status).to.equal(200);
          expect(ran).to.deep.equal(['getUrl']);
          expect(warnings).to.deep.equal([]);
        });

        it("lets the owner's Bearer token through", async () => {
          const { app, ran } = await lab();
          await request(app)
            .get('/wd/hub/session/s-alice/url')
            .set(bearer('alice-jwt'))
            .expect(200);
          expect(ran).to.deep.equal(['getUrl']);
        });

        it('refuses another user with the unknown-session answer, before the route runs', async () => {
          const { app, ran } = await lab();
          const res = await request(app).get('/wd/hub/session/s-alice/url').set(as('bob-token'));
          await expectRefused(res);
          expect(ran).to.deep.equal([]);
        });

        it('logs the refusal with the session and the caller, never the credential', async () => {
          const { app } = await lab();
          await request(app).get('/wd/hub/session/s-alice/url').set(as('bob-token'));
          expect(warnings).to.have.length(1);
          expect(warnings[0]).to.include('s-alice');
          expect(warnings[0]).to.include('bob');
          expect(warnings[0]).not.to.include('bob-token');
          expect(warnings[0]).not.to.include('ak-bob');
        });

        it('refuses a request with no credentials, without looking anything up', async () => {
          const { app, ran } = await lab();
          await expectRefused(await request(app).get('/wd/hub/session/s-alice/url'));
          expect(ran).to.deep.equal([]);
          expect(verifyKeyPair.called || verifyBearer.called).to.equal(false);
          expect(ownerOf.called).to.equal(false);
          expect(warnings).to.have.length(1);
          expect(warnings[0]).to.include('no credentials');
        });

        it('refuses credentials that do not verify, without looking up the owner', async () => {
          const { app } = await lab();
          const res = await request(app)
            .get('/wd/hub/session/s-alice/url')
            .set({ 'x-xenon-access-key': 'ak-alice', 'x-xenon-token': 'guessed' });
          await expectRefused(res);
          expect(ownerOf.called).to.equal(false);
          expect(warnings[0]).to.include('invalid credentials');
          expect(warnings[0]).not.to.include('guessed');
        });

        it('lets an admin-scoped key drive a session it does not own', async () => {
          const { app, ran } = await lab();
          await request(app).get('/wd/hub/session/s-alice/url').set(as('carol-admin')).expect(200);
          expect(ran).to.deep.equal(['getUrl']);
        });

        it('lets a SUPER_ADMIN drive a session they do not own', async () => {
          const { app, ran } = await lab();
          await request(app).get('/wd/hub/session/s-alice/url').set(bearer('root-jwt')).expect(200);
          expect(ran).to.deep.equal(['getUrl']);
        });

        it("refuses an ADMIN's ordinary key on someone else's session", async () => {
          const { app, ran } = await lab();
          await expectRefused(
            await request(app).get('/wd/hub/session/s-alice/url').set(as('carol-ordinary')),
          );
          expect(ran).to.deep.equal([]);
        });

        it('refuses everyone but override admins on a session nobody owns', async () => {
          const { app, ran } = await lab();
          await expectRefused(
            await request(app).get('/wd/hub/session/s-anon/url').set(as('alice-token')),
          );
          await expectRefused(
            await request(app).get('/wd/hub/session/s-anon/url').set(as('carol-ordinary')),
          );
          expect(ran).to.deep.equal([]);
          await request(app).get('/wd/hub/session/s-anon/url').set(as('carol-admin')).expect(200);
          await request(app).get('/wd/hub/session/s-anon/url').set(bearer('root-jwt')).expect(200);
          expect(ran).to.deep.equal(['getUrl', 'getUrl']);
        });

        it('answers a session the caller may not use exactly as one that does not exist', async () => {
          const { app } = await lab();
          const refused = await request(app)
            .get('/wd/hub/session/s-alice/url')
            .set(as('bob-token'));
          const missing = await request(app)
            .get('/wd/hub/session/no-such-session/url')
            .set(as('bob-token'));
          expect(refused.status).to.equal(missing.status);
          expect(refused.headers['content-type']).to.equal(missing.headers['content-type']);
          expect(refused.text).to.equal(missing.text);
        });
      });

      describe('every method and command under the session', () => {
        const commands: Array<[string, string, string]> = [
          ['get', '/wd/hub/session/s-alice', 'getSession'],
          ['delete', '/wd/hub/session/s-alice', 'deleteSession'],
          ['get', '/wd/hub/session/s-alice/url', 'getUrl'],
          ['post', '/wd/hub/session/s-alice/element', 'findElement'],
        ];
        for (const [method, url, name] of commands) {
          it(`guards ${method.toUpperCase()} ${url.replace('/wd/hub', '')}`, async () => {
            const { app, ran } = await lab();
            await expectRefused(
              await (request(app) as any)[method](url).set(as('bob-token')).send({}),
            );
            expect(ran).to.deep.equal([]);
            await (request(app) as any)[method](url).set(as('alice-token')).send({}).expect(200);
            expect(ran).to.deep.equal([name]);
          });
        }

        it('guards a path in another letter case, which the routes also match', async () => {
          const { app, ran } = await lab();
          await expectRefused(
            await request(app).get('/WD/HUB/SESSION/s-alice/url').set(as('bob-token')),
          );
          expect(ran).to.deep.equal([]);
        });
      });

      describe('what it leaves alone', () => {
        it('lets createSession through; it has its own credential checks', async () => {
          const { app, ran } = await lab();
          await request(app).post('/wd/hub/session').send({ capabilities: {} }).expect(200);
          expect(ran).to.deep.equal(['createSession']);
          expect(ownerOf.called).to.equal(false);
        });

        it('lets requests that are not session commands through', async () => {
          const { app, ran } = await lab();
          await request(app).get('/wd/hub/status').expect(200);
          await request(app).get('/wd/hub/appium/sessions').expect(200);
          await request(app).get('/xenon/api/devices').expect(200);
          expect(ran).to.deep.equal(['getStatus', 'getAppiumSessions', 'xenonApi']);
          expect(verifyKeyPair.called || verifyBearer.called || ownerOf.called).to.equal(false);
        });

        it('does nothing at all when the setting is off (the default)', async () => {
          enabled = false;
          const { app, ran } = await lab();
          await request(app).get('/wd/hub/session/s-alice/url').expect(200);
          await request(app).get('/wd/hub/session/s-alice/url').set(as('bob-token')).expect(200);
          expect(ran).to.deep.equal(['getUrl', 'getUrl']);
          expect(verifyKeyPair.called || verifyBearer.called || ownerOf.called).to.equal(false);
          expect(warnings).to.deep.equal([]);
        });

        it('does nothing when auth is disabled, even with the setting on', async () => {
          authDisabled = true;
          const { app, ran } = await lab();
          await request(app).get('/wd/hub/session/s-alice/url').expect(200);
          expect(ran).to.deep.equal(['getUrl']);
          expect(verifyKeyPair.called || verifyBearer.called || ownerOf.called).to.equal(false);
        });
      });

      describe('failing closed', () => {
        it('answers 503 when the owner lookup fails, never letting the command through', async () => {
          ownerOf.rejects(new Error('database is locked'));
          const { app, ran } = await lab();
          const res = await request(app).get('/wd/hub/session/s-alice/url').set(as('alice-token'));
          expect(res.status).to.equal(503);
          expect(res.body).to.deep.equal(COMMAND_AUTH_UNAVAILABLE_BODY);
          expect(ran).to.deep.equal([]);
          expect(errors).to.have.length(1);
          expect(errors[0]).to.include('s-alice');
        });

        it('answers 503 when the credential check fails', async () => {
          verifyKeyPair.rejects(new Error('database is locked'));
          const { app, ran } = await lab();
          const res = await request(app).get('/wd/hub/session/s-alice/url').set(as('alice-token'));
          expect(res.status).to.equal(503);
          expect(res.body).to.deep.equal(COMMAND_AUTH_UNAVAILABLE_BODY);
          expect(ran).to.deep.equal([]);
        });
      });

      describe('base path', () => {
        it("normalises the base path the way Appium does ('wd/hub/' → '/wd/hub')", async () => {
          const { app, ran } = await lab({ basePath: 'wd/hub/' });
          await expectRefused(
            await request(app).get('/wd/hub/session/s-alice/url').set(as('bob-token')),
          );
          expect(ran).to.deep.equal([]);
        });

        it("guards /session/:id under Appium 3's default empty base path", async () => {
          const { app, ran } = await lab({ basePath: '', routePrefix: '' });
          await expectRefused(await request(app).get('/session/s-alice/url').set(as('bob-token')));
          await request(app).post('/session').send({}).expect(200);
          expect(ran).to.deep.equal(['createSession']);
        });
      });
    });
  }

  describe('when it cannot be placed ahead of the routes', () => {
    const noRouter = () => ({ use: () => undefined });
    const quiet = (errors: string[]) => ({
      info: () => undefined,
      warn: () => undefined,
      error: (m: string) => errors.push(m),
    });

    it('logs an error and refuses to start when the setting is on', () => {
      const errors: string[] = [];
      expect(() =>
        registerCommandAuth(
          noRouter(),
          { basePath: '/wd/hub' },
          {
            enabled: () => true,
            authDisabled: () => false,
            logger: quiet(errors),
          },
        ),
      ).to.throw(/XENON_REQUIRE_COMMAND_AUTH/);
      expect(errors).to.have.length(1);
    });

    it('logs an error but starts when the setting is off', () => {
      const errors: string[] = [];
      const result = registerCommandAuth(
        noRouter(),
        { basePath: '/wd/hub' },
        {
          enabled: () => false,
          authDisabled: () => false,
          logger: quiet(errors),
        },
      );
      expect(result.placed).to.equal(false);
      expect(errors).to.have.length(1);
    });

    it('starts when auth is disabled, since the check would never apply', () => {
      const errors: string[] = [];
      expect(() =>
        registerCommandAuth(
          noRouter(),
          { basePath: '/wd/hub' },
          {
            enabled: () => true,
            authDisabled: () => true,
            logger: quiet(errors),
          },
        ),
      ).not.to.throw();
    });
  });
});
