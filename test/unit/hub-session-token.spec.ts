import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import * as jose from 'jose';
import { Container } from 'typedi';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import {
  HUB_TOKEN_AUDIENCE,
  HUB_TOKEN_TTL_SECONDS,
  HubSessionTokenIssuer,
  HubSessionTokenVerifier,
  HubTokenUnavailableError,
  hubJwksUrl,
} from '../../src/gateway/hubSessionToken';
import { saveRegistrations } from '../helpers/container-registration';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * The hub's session token: what a node accepts, with its own per-command auth
 * on, in place of the client's credentials the hub already checked. Signed by
 * the hub's JwtKeyService, checked by the node against the hub's public keys.
 */
describe('hub session tokens', () => {
  const loopback = loopbackServers();
  let dirs: string[];
  let restore: () => void;
  let hubKeys: JwtKeyService;
  let hubUrl: string;

  async function keyService(): Promise<JwtKeyService> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-hub-token-'));
    dirs.push(dir);
    const keys = new JwtKeyService();
    await keys.init(dir);
    return keys;
  }

  beforeEach(async () => {
    dirs = [];
    restore = saveRegistrations(JwtKeyService, HubSessionTokenIssuer);
    hubKeys = await keyService();
    Container.set(JwtKeyService, hubKeys);
    // The hub serves its keys the way the real route does.
    const hub = express();
    hub.get('/xenon/api/auth/jwks.json', (_req, res) => res.json(hubKeys.jwks()));
    const server = await loopback.serve(hub);
    hubUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterEach(async () => {
    sinon.restore();
    restore();
    await loopback.closeAll();
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('HubSessionTokenIssuer (hub)', () => {
    it('signs a token for one session, audience xenon-node, for five minutes', async () => {
      const issuer = new HubSessionTokenIssuer();
      const token = await issuer.tokenFor('s-1');
      expect(token).to.be.a('string');
      const claims = jose.decodeJwt(token as string);
      expect(claims.aud).to.equal(HUB_TOKEN_AUDIENCE);
      expect(claims.sid).to.equal('s-1');
      expect((claims.exp as number) - (claims.iat as number)).to.equal(HUB_TOKEN_TTL_SECONDS);
      // The hub's own key verifies it.
      await hubKeys.verify(token as string, { audience: HUB_TOKEN_AUDIENCE });
    });

    it('reuses a session’s token until it is forgotten', async () => {
      const issuer = new HubSessionTokenIssuer();
      const sign = sinon.spy(hubKeys, 'sign');
      const first = await issuer.tokenFor('s-1');
      expect(await issuer.tokenFor('s-1')).to.equal(first);
      expect(sign.callCount).to.equal(1);
      await issuer.tokenFor('s-2');
      expect(sign.callCount).to.equal(2);
      issuer.forget('s-1');
      await issuer.tokenFor('s-1');
      expect(sign.callCount).to.equal(3);
    });

    it('answers null, and warns once, when this server cannot sign', async () => {
      Container.set(JwtKeyService, new JwtKeyService()); // never initialised
      const issuer = new HubSessionTokenIssuer();
      const warn = sinon.stub((issuer as any).logger, 'warn');
      expect(await issuer.tokenFor('s-1')).to.equal(null);
      expect(await issuer.tokenFor('s-2')).to.equal(null);
      expect(warn.callCount).to.equal(1);
    });

    it('is an audience /auth/token will not mint for a user', () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, '../../src/app/routers/auth.ts'),
        'utf8',
      );
      const mintable = /MINTABLE_AUDIENCES = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
      expect(mintable).to.include('xenon-rest');
      expect(mintable).not.to.include(HUB_TOKEN_AUDIENCE);
    });
  });

  describe('HubSessionTokenVerifier (node)', () => {
    it('fetches the keys from the hub’s public JWKS route', () => {
      expect(hubJwksUrl('http://hub:4724').toString()).to.equal(
        'http://hub:4724/xenon/api/auth/jwks.json',
      );
    });

    it('accepts the hub’s token for its session', async () => {
      const token = (await new HubSessionTokenIssuer().tokenFor('s-1')) as string;
      expect(await new HubSessionTokenVerifier(hubUrl).verify(token, 's-1')).to.equal(true);
    });

    it('refuses the hub’s token for another session', async () => {
      const token = (await new HubSessionTokenIssuer().tokenFor('s-1')) as string;
      expect(await new HubSessionTokenVerifier(hubUrl).verify(token, 's-2')).to.equal(false);
    });

    it('refuses an expired token', async () => {
      const token = await hubKeys.sign(
        { sid: 's-1' },
        { audience: HUB_TOKEN_AUDIENCE, ttlSeconds: -3600 },
      );
      expect(await new HubSessionTokenVerifier(hubUrl).verify(token, 's-1')).to.equal(false);
    });

    it('refuses a token signed by another key, even under the hub’s key id', async () => {
      const other = await keyService();
      const foreign = await other.sign(
        { sid: 's-1' },
        { audience: HUB_TOKEN_AUDIENCE, ttlSeconds: 300 },
      );
      const verifier = new HubSessionTokenVerifier(hubUrl);
      expect(await verifier.verify(foreign, 's-1')).to.equal(false);

      const hubKid = hubKeys.jwks().keys[0].kid as string;
      const { privateKey } = await jose.generateKeyPair('RS256');
      const forged = await new jose.SignJWT({ sid: 's-1' })
        .setProtectedHeader({ alg: 'RS256', kid: hubKid })
        .setAudience(HUB_TOKEN_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      expect(await verifier.verify(forged, 's-1')).to.equal(false);
    });

    it('refuses the hub’s token for another audience', async () => {
      const rest = await hubKeys.sign(
        { sid: 's-1', sub: 'alice' },
        { audience: 'xenon-rest', ttlSeconds: 300 },
      );
      expect(await new HubSessionTokenVerifier(hubUrl).verify(rest, 's-1')).to.equal(false);
    });

    it('refuses what is not a token at all', async () => {
      expect(await new HubSessionTokenVerifier(hubUrl).verify('not-a-jwt', 's-1')).to.equal(false);
    });

    it('throws HubTokenUnavailableError when the hub’s keys cannot be fetched', async () => {
      const token = (await new HubSessionTokenIssuer().tokenFor('s-1')) as string;
      await loopback.closeAll();
      let thrown: unknown;
      try {
        await new HubSessionTokenVerifier(hubUrl).verify(token, 's-1');
      } catch (err) {
        thrown = err;
      }
      expect(thrown).to.be.instanceOf(HubTokenUnavailableError);
    });
  });
});
