import 'reflect-metadata';
import { expect } from 'chai';
import * as jose from 'jose';
import { Container } from 'typedi';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { issueToken } from '../../src/app/routers/auth';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * A token POST /auth/token mints never carries more than the credential
 * minting it: not more scopes, and not a longer life.
 *
 * - The `sessionToken` beside a xenon-mcp token creates Appium sessions, so
 *   it is minted only when the grant includes `appium:use` (which needs the
 *   `sessions` scope), and carries the scopes a session is judged by. Any
 *   credential used to get one, a read-only key included.
 * - A token minted with a Bearer token, or an API key that expires, ends no
 *   later than that credential. A 1-hour token used to mint a fresh 1-hour
 *   token, for ever.
 */
describe('POST /auth/token mints nothing its creator does not have', () => {
  let dir: string;
  let restoreContainer: () => void;

  beforeEach(async () => {
    restoreContainer = saveRegistrations(JwtKeyService);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-mint-limits-'));
    const svc = new JwtKeyService();
    await svc.init(dir);
    Container.set(JwtKeyService, svc);
  });

  afterEach(() => {
    restoreContainer();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const base = { kind: 'api-key', userId: 'u1', role: 'MEMBER', teamId: null, rateLimit: 300 };
  const auth = (extra: Record<string, unknown>) => ({ ...base, ...extra }) as any;

  describe('the session token', () => {
    it('is not minted for a read-only credential', async () => {
      const out = await issueToken(auth({ scopes: 'read' }), { audience: 'xenon-mcp' });
      expect(out.token).to.be.a('string');
      expect(out.sessionToken).to.equal(undefined);
    });

    it('is not minted when the grant asked for leaves out appium:use', async () => {
      const out = await issueToken(auth({ scopes: 'devices,sessions,read' }), {
        audience: 'xenon-mcp',
        scopes: ['xenon:devices:read'],
      });
      expect(out.sessionToken).to.equal(undefined);
    });

    it('carries `sessions`, and `admin` only when its creator has it', async () => {
      const member = await issueToken(auth({ scopes: 'devices,sessions,read' }), {
        audience: 'xenon-mcp',
      });
      expect(jose.decodeJwt(String(member.sessionToken)).scopes).to.equal('sessions');

      const dashboardAdmin = await issueToken(
        auth({ kind: 'user-session', role: 'ADMIN', scopes: 'admin,devices,sessions,read' }),
        { audience: 'xenon-mcp' },
      );
      expect(jose.decodeJwt(String(dashboardAdmin.sessionToken)).scopes).to.equal('admin,sessions');
    });
  });

  describe('its lifetime', () => {
    const now = () => Math.floor(Date.now() / 1000);

    for (const audience of ['xenon-rest', 'xenon-mcp'] as const) {
      it(`a ${audience} token ends no later than the credential that minted it`, async () => {
        const creatorExp = now() + 600;
        const out = await issueToken(
          auth({ kind: 'bearer', scopes: 'sessions,read', credentialExpiresAt: creatorExp * 1000 }),
          { audience },
        );
        const p = jose.decodeJwt(out.token);
        expect(p.exp).to.be.at.most(creatorExp);
        expect(out.expiresIn).to.be.at.most(600);
        expect(out.expiresIn).to.be.at.least(598);
        if (out.sessionToken) {
          expect(jose.decodeJwt(out.sessionToken).exp).to.be.at.most(creatorExp);
        }
      });
    }

    it('keeps its own lifetime when the credential outlives it', async () => {
      const out = await issueToken(
        auth({ scopes: 'sessions', credentialExpiresAt: Date.now() + 30 * 86_400_000 }),
        { audience: 'xenon-rest' },
      );
      expect(out.expiresIn).to.equal(3600);
    });

    it('is refused when the credential has already expired', async () => {
      let caught: Error | undefined;
      try {
        await issueToken(auth({ scopes: 'sessions', credentialExpiresAt: Date.now() - 1000 }), {
          audience: 'xenon-rest',
        });
      } catch (err: any) {
        caught = err;
      }
      expect(caught?.message).to.match(/expired/);
    });
  });
});
