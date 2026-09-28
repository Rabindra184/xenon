import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import {
  ACCEPTED_BEARER_AUDIENCES,
  verifyBearerCredential,
  verifyKeyPairCredential,
} from '../../src/middleware/verifyCredential';

/**
 * The credential checks authMiddleware applies to the header pair and to a
 * Bearer JWT, pulled out so the WebDriver per-command check verifies exactly
 * the same way instead of keeping a copy.
 *
 * A credential that is wrong resolves to null. A check that could not run
 * (the database or the signing key is unavailable) throws, so a caller that
 * must tell the two apart can: per-command auth answers 503 for the second.
 */
describe('verifyCredential', () => {
  let dir: string;
  let keys: JwtKeyService;
  const active = { id: 'u1', role: 'MEMBER', status: 'ACTIVE' };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-verify-cred-'));
    keys = new JwtKeyService();
    await keys.init(dir);
    Container.set(JwtKeyService, keys);
    Container.set(UserService, { findById: sinon.stub().resolves(active) } as any);
    Container.set(ApiKeyService, { verifyPair: sinon.stub().resolves(null) } as any);
  });

  afterEach(() => {
    sinon.restore();
    Container.reset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('verifyBearerCredential', () => {
    it('accepts the audiences REST accepts', () => {
      expect([...ACCEPTED_BEARER_AUDIENCES]).to.deep.equal(['xenon-rest', 'xenon-mcp']);
    });

    for (const audience of ['xenon-rest', 'xenon-mcp']) {
      it(`verifies a ${audience} token and returns its payload and live user`, async () => {
        const token = await keys.sign(
          { sub: 'u1', scopes: 'sessions' },
          { audience, ttlSeconds: 60 },
        );
        const out = await verifyBearerCredential(token);
        expect(out?.user.id).to.equal('u1');
        expect(out?.payload.scopes).to.equal('sessions');
      });
    }

    it('returns null for a token with another audience (a xenon-session token included)', async () => {
      const token = await keys.sign({ sub: 'u1' }, { audience: 'xenon-session', ttlSeconds: 60 });
      expect(await verifyBearerCredential(token)).to.equal(null);
    });

    it('returns null for garbage', async () => {
      expect(await verifyBearerCredential('not-a-jwt')).to.equal(null);
    });

    it('returns null for an expired token', async () => {
      const token = await keys.sign({ sub: 'u1' }, { audience: 'xenon-rest', ttlSeconds: -120 });
      expect(await verifyBearerCredential(token)).to.equal(null);
    });

    it('returns null when the user is no longer ACTIVE', async () => {
      (Container.get(UserService).findById as sinon.SinonStub).resolves({
        ...active,
        status: 'DISABLED',
      });
      const token = await keys.sign({ sub: 'u1' }, { audience: 'xenon-rest', ttlSeconds: 60 });
      expect(await verifyBearerCredential(token)).to.equal(null);
    });

    it('throws when the signing key is not available, rather than calling the token invalid', async () => {
      Container.set(JwtKeyService, new JwtKeyService()); // never initialised
      const token = await keys.sign({ sub: 'u1' }, { audience: 'xenon-rest', ttlSeconds: 60 });
      let caught: unknown;
      try {
        await verifyBearerCredential(token);
      } catch (err) {
        caught = err;
      }
      expect(String(caught)).to.match(/not initialized/);
    });

    it('throws when the user lookup fails', async () => {
      (Container.get(UserService).findById as sinon.SinonStub).rejects(new Error('db down'));
      const token = await keys.sign({ sub: 'u1' }, { audience: 'xenon-rest', ttlSeconds: 60 });
      let caught: unknown;
      try {
        await verifyBearerCredential(token);
      } catch (err) {
        caught = err;
      }
      expect(String(caught)).to.match(/db down/);
    });
  });

  describe('verifyKeyPairCredential', () => {
    const row = { id: 'k1', userId: 'u1', scopes: 'sessions', rateLimit: 300, teamId: null };

    it('returns the key row and its ACTIVE owner', async () => {
      (Container.get(ApiKeyService).verifyPair as sinon.SinonStub).resolves(row);
      const out = await verifyKeyPairCredential('xen_ak', 'tok');
      expect(out?.row.id).to.equal('k1');
      expect(out?.user.id).to.equal('u1');
      expect(
        (Container.get(ApiKeyService).verifyPair as sinon.SinonStub).calledWith('xen_ak', 'tok'),
      ).to.equal(true);
    });

    it('returns null for a pair that does not verify', async () => {
      expect(await verifyKeyPairCredential('xen_ak', 'wrong')).to.equal(null);
    });

    it('returns null when the key has no owner', async () => {
      (Container.get(ApiKeyService).verifyPair as sinon.SinonStub).resolves({ ...row, userId: '' });
      expect(await verifyKeyPairCredential('xen_ak', 'tok')).to.equal(null);
    });

    it('returns null when the owner is no longer ACTIVE', async () => {
      (Container.get(ApiKeyService).verifyPair as sinon.SinonStub).resolves(row);
      (Container.get(UserService).findById as sinon.SinonStub).resolves({
        ...active,
        status: 'DISABLED',
      });
      expect(await verifyKeyPairCredential('xen_ak', 'tok')).to.equal(null);
    });

    it('throws when the key lookup fails', async () => {
      (Container.get(ApiKeyService).verifyPair as sinon.SinonStub).rejects(new Error('db down'));
      let caught: unknown;
      try {
        await verifyKeyPairCredential('xen_ak', 'tok');
      } catch (err) {
        caught = err;
      }
      expect(String(caught)).to.match(/db down/);
    });
  });
});
