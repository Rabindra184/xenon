import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { loopbackServers } from '../helpers/loopbackServer';
import { createSessionCreateLayer } from '../../src/gateway/sessionCreate';
import { BasicCredentialRefused, readBasicCredential } from '../../src/middleware/basicCredential';
import { readPresentedCredential } from '../../src/middleware/commandCaller';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { takeSessionCredentials } from '../../src/services/session/sessionCredentials';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserService } from '../../src/services/UserService';
import { config } from '../../src/config';
import { saveRegistrations } from '../helpers/container-registration';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const basicHeader = (accessKey: string, token: string) => `Basic ${b64(`${accessKey}:${token}`)}`;

/**
 * A WebDriver client may carry its key pair in the hub URL,
 * `http://ACCESS_KEY:TOKEN@host:4723/wd/hub`, which it sends as
 * `Authorization: Basic base64(key:token)`. It is the same key pair as
 * `xe:options.accessKey` / `token`, checked by the same rule. On a create, the
 * xe:options pair decides when it is there; a Basic credential that can't be
 * read or doesn't verify refuses the create with 401.
 */
describe('The key pair in the hub URL (Basic auth)', function () {
  this.timeout(30_000);

  describe('readBasicCredential', () => {
    it('reads a key and token', () => {
      expect(readBasicCredential(basicHeader('ak_1', 'tok_2'))).to.deep.equal({
        kind: 'pair',
        accessKey: 'ak_1',
        token: 'tok_2',
      });
    });

    it('splits at the first colon, so a token may hold one', () => {
      const read = readBasicCredential(basicHeader('ak_1', 'to:ken'));
      expect(read).to.deep.equal({ kind: 'pair', accessKey: 'ak_1', token: 'to:ken' });
    });

    it('reads the scheme in any case', () => {
      expect(readBasicCredential(`basic ${b64('ak:tk')}`).kind).to.equal('pair');
    });

    it('reads nothing from no header, or another scheme', () => {
      expect(readBasicCredential(undefined).kind).to.equal('none');
      expect(readBasicCredential('Bearer abc.def.ghi').kind).to.equal('none');
      expect(readBasicCredential(['Basic x']).kind).to.equal('none');
    });

    for (const [why, header] of [
      ['malformed base64', 'Basic !!!!'],
      ['base64 cut short', 'Basic YWs6dG'],
      ['base64 with junk inside', `Basic ${b64('ak:tk').slice(0, 2)}*${b64('ak:tk').slice(3)}`],
      ['a missing colon', `Basic ${b64('aktoken')}`],
      ['an empty access key', `Basic ${b64(':tk')}`],
      ['an empty token', `Basic ${b64('ak:')}`],
      ['nothing after Basic', 'Basic'],
      ['two values', `Basic ${b64('ak:tk')} ${b64('x:y')}`],
    ] as const) {
      it(`takes ${why} for unreadable`, () => {
        expect(readBasicCredential(header).kind).to.equal('unreadable');
      });
    }

    it('per command: Basic is a key pair, and the x-xenon pair wins over it', () => {
      expect(readPresentedCredential({ authorization: basicHeader('ak', 'tk') })).to.deep.equal({
        kind: 'key-pair',
        accessKey: 'ak',
        token: 'tk',
      });
      expect(
        readPresentedCredential({
          authorization: basicHeader('ak', 'tk'),
          'x-xenon-access-key': 'other',
          'x-xenon-token': 'pair',
        }),
      ).to.deep.equal({ kind: 'key-pair', accessKey: 'other', token: 'pair' });
      expect(readPresentedCredential({ authorization: 'Basic nope' })).to.deep.equal({
        kind: 'unreadable',
      });
    });
  });

  describe("the gateway's create layer", () => {
    const loopback = loopbackServers();
    afterEach(async () => {
      sinon.restore();
      await loopback.closeAll();
    });

    async function serve(prepareSession: sinon.SinonStub) {
      const seenByAppium: Array<string | undefined> = [];
      const app = express();
      app.use(express.json());
      app.use(
        '/wd/hub/session',
        createSessionCreateLayer({
          lifecycle: () =>
            ({
              prepareSession,
              completeRemoteSession: sinon.stub(),
              releaseAllocation: sinon.stub().resolves(),
            }) as any,
          authDisabled: () => false,
          logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
        }),
      );
      app.post('/wd/hub/session', (req, res) => {
        seenByAppium.push(req.headers.authorization);
        res.json({ value: { sessionId: 's1', capabilities: {} } });
      });
      const server = await loopback.serve(app);
      return { base: `http://127.0.0.1:${(server.address() as any).port}`, seenByAppium };
    }
    const caps = { capabilities: { alwaysMatch: { platformName: 'Android' }, firstMatch: [{}] } };

    it('hands the Basic credential to the create, and takes it off the request', async () => {
      const prepareSession = sinon.stub().resolves({ remote: false });
      const { base, seenByAppium } = await serve(prepareSession);
      await request(base)
        .post('/wd/hub/session')
        .set('authorization', basicHeader('ak_1', 'tok_2'))
        .send(caps)
        .expect(200);
      expect(prepareSession.firstCall.args[1]).to.deep.equal({
        basic: { kind: 'pair', accessKey: 'ak_1', token: 'tok_2' },
      });
      expect(seenByAppium).to.deep.equal([undefined]);
    });

    it('answers a refused Basic credential with 401, WebDriver-shaped, naming no credential', async () => {
      const prepareSession = sinon.stub().rejects(new BasicCredentialRefused('invalid'));
      const { base } = await serve(prepareSession);
      const res = await request(base)
        .post('/wd/hub/session')
        .set('authorization', basicHeader('ak_1', 'wrong-token'))
        .send(caps);
      expect(res.status).to.equal(401);
      expect(res.headers['www-authenticate']).to.equal('Basic realm="Xenon"');
      expect(res.body.value.error).to.equal('session not created');
      expect(res.text).not.to.include('wrong-token');
      expect(res.text).not.to.include('ak_1');
    });

    it('leaves a Bearer header where it was', async () => {
      const prepareSession = sinon.stub().resolves({ remote: false });
      const { base, seenByAppium } = await serve(prepareSession);
      await request(base)
        .post('/wd/hub/session')
        .set('authorization', 'Bearer x.y.z')
        .send(caps)
        .expect(200);
      expect(prepareSession.firstCall.args[1]).to.deep.equal({});
      expect(seenByAppium).to.deep.equal(['Bearer x.y.z']);
    });
  });

  describe("the create's check", () => {
    let restore: () => void;
    let authDisabledBefore: boolean;
    let svc: SessionLifecycleService;
    const KEYS: Record<string, any> = {
      'ak_alice:tok_alice': { id: 'key-alice', userId: 'alice', scopes: 'sessions', teamId: null },
      'ak_bob:tok_bob': { id: 'key-bob', userId: 'bob', scopes: 'sessions', teamId: null },
    };

    beforeEach(() => {
      authDisabledBefore = config.authDisabled;
      config.authDisabled = false;
      restore = saveRegistrations(ApiKeyService, UserService);
      Container.set(ApiKeyService, {
        verifyPair: sinon
          .stub()
          .callsFake(async (ak: string, tk: string) => KEYS[`${ak}:${tk}`] ?? null),
        hasScope: (row: any, req: string[]) => req.some((s) => row.scopes.split(',').includes(s)),
      } as any);
      Container.set(UserService, {
        findById: async (id: string) => ({ id, role: 'MEMBER', status: 'ACTIVE' }),
      } as any);
      svc = new SessionLifecycleService();
    });

    afterEach(() => {
      config.authDisabled = authDisabledBefore;
      sinon.restore();
      restore();
    });

    const authorize = (options: Record<string, unknown> | undefined, header?: string) => {
      const caps: any = {
        alwaysMatch: { platformName: 'Android', ...(options ? { 'xe:options': options } : {}) },
        firstMatch: [{}],
      };
      const credentials = { ...takeSessionCredentials(caps), basic: readBasicCredential(header) };
      return (svc as any).authorizeSessionRequest(caps, credentials);
    };

    it('attributes the session to the key in the hub URL', async () => {
      const out = await authorize(undefined, basicHeader('ak_alice', 'tok_alice'));
      expect(out.apiKeyId).to.equal('key-alice');
      expect(out.userId).to.equal('alice');
    });

    it('refuses a key that does not verify, with BasicCredentialRefused', async () => {
      let thrown: any;
      await authorize(undefined, basicHeader('ak_alice', 'wrong')).catch((e: any) => (thrown = e));
      expect(thrown).to.be.instanceOf(BasicCredentialRefused);
      expect(thrown.reason).to.equal('invalid');
      expect(String(thrown.message)).not.to.include('wrong');
    });

    it('refuses one that cannot be read', async () => {
      let thrown: any;
      await authorize(undefined, `Basic ${b64('no-colon')}`).catch((e: any) => (thrown = e));
      expect(thrown).to.be.instanceOf(BasicCredentialRefused);
      expect(thrown.reason).to.equal('unreadable');
    });

    it('lets the xe:options pair decide when there is one, whatever the hub URL holds', async () => {
      const out = await authorize(
        { accessKey: 'ak_bob', token: 'tok_bob' },
        basicHeader('ak_alice', 'tok_alice'),
      );
      expect(out.userId).to.equal('bob');
      // A wrong pair is ignored, as always, and a wrong Basic credential beside it isn't read.
      const ignored = await authorize({ accessKey: 'ak_bob', token: 'nope' }, 'Basic garbage');
      expect(ignored.userId ?? null).to.equal(null);
    });

    it('reads no Basic credential with sign-in off', async () => {
      config.authDisabled = true;
      const out = await authorize(undefined, 'Basic garbage');
      expect(out.apiKeyId ?? null).to.equal(null);
    });
  });
});
