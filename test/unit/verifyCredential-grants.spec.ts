import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Request } from 'express';
import { Container } from 'typedi';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { UserService } from '../../src/services/UserService';
import {
  SessionTokenGrantRevokedError,
  isWrongSessionToken,
  verifyBearerCredential,
  verifySessionTokenCredential,
} from '../../src/middleware/verifyCredential';
import { CommandCallerVerifier } from '../../src/middleware/commandCaller';
import { resolveMcpCaller } from '../../src/mcp/mcpCredential';
import { LIVE_GRANT_TTL_MS, RevokedGrants } from '../../src/services/oauth/revokedGrants';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * A token issued under a sign-in grant (`gid`) is refused once the grant is
 * revoked or gone, at once (RevokedGrants, told by GrantStore.revoke); a
 * token without `gid` is checked as before, with no grant lookup. A grant
 * lookup that fails throws, so every caller fails closed as for the user
 * lookup.
 */
describe('verifyBearerCredential and sign-in grants', () => {
  let dir: string;
  let keys: JwtKeyService;
  let grants: RevokedGrants;
  let lookup: sinon.SinonStub;
  let clock: number;
  let savedAuthDisabled: boolean;
  let restoreContainer: () => void;
  const admin = { id: 'u1', role: 'ADMIN', status: 'ACTIVE' };

  beforeEach(async () => {
    savedAuthDisabled = config.authDisabled;
    config.authDisabled = false;
    restoreContainer = saveRegistrations(JwtKeyService, UserService, RevokedGrants);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-verify-grants-'));
    keys = new JwtKeyService();
    await keys.init(dir);
    Container.set(JwtKeyService, keys);
    Container.set(UserService, { findById: sinon.stub().resolves(admin) } as any);
    clock = 1_000_000;
    lookup = sinon.stub().resolves(true);
    grants = new RevokedGrants();
    grants.lookup = lookup;
    grants.now = () => clock;
    Container.set(RevokedGrants, grants);
  });

  afterEach(() => {
    sinon.restore();
    restoreContainer();
    config.authDisabled = savedAuthDisabled;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const tokenWith = (claims: Record<string, unknown> = {}) =>
    keys.sign(
      { sub: 'u1', scopes: 'devices,read', ...claims },
      { audience: 'xenon-mcp', ttlSeconds: 600 },
    );

  it('a token without gid makes no grant lookup', async () => {
    const findUnique = sinon.stub(prisma.mcpGrant, 'findUnique').rejects(new Error('not asked'));
    expect(await verifyBearerCredential(await tokenWith())).to.not.equal(null);
    expect(lookup.called).to.equal(false);
    expect(findUnique.called).to.equal(false);
  });

  it('refuses a token whose grant is revoked or missing, and keeps refusing it', async () => {
    lookup.resolves(false);
    const token = await tokenWith({ gid: 'g-gone' });
    expect(await verifyBearerCredential(token)).to.equal(null);
    clock += LIVE_GRANT_TTL_MS * 10;
    expect(await verifyBearerCredential(token)).to.equal(null);
    expect(lookup.callCount).to.equal(1);
  });

  it('a live grant is asked once per 30 s', async () => {
    const token = await tokenWith({ gid: 'g-live' });
    expect(await verifyBearerCredential(token)).to.not.equal(null);
    clock += LIVE_GRANT_TTL_MS - 1;
    expect(await verifyBearerCredential(token)).to.not.equal(null);
    expect(lookup.callCount).to.equal(1);
    clock += 1;
    expect(await verifyBearerCredential(token)).to.not.equal(null);
    expect(lookup.callCount).to.equal(2);
  });

  it('a revoke refuses a grant known live at once', async () => {
    const token = await tokenWith({ gid: 'g-revoked' });
    expect(await verifyBearerCredential(token)).to.not.equal(null);
    grants.revoked('g-revoked');
    expect(await verifyBearerCredential(token)).to.equal(null);
    expect(lookup.callCount).to.equal(1);
  });

  /** The first grant lookup waits for `finish`; `asked` settles once it has begun. */
  function holdFirstLookup() {
    let finish!: (live: boolean) => void;
    let begun!: () => void;
    const asked = new Promise<void>((resolve) => (begun = resolve));
    lookup.onFirstCall().callsFake(() => {
      begun();
      return new Promise<boolean>((resolve) => (finish = resolve));
    });
    return { asked, finish: (live: boolean) => finish(live) };
  }

  it('a lookup in flight when its grant is revoked answers refused and keeps nothing live', async () => {
    const { asked, finish } = holdFirstLookup();
    const token = await tokenWith({ gid: 'g-race' });
    const inFlight = verifyBearerCredential(token);
    await asked;
    grants.revoked('g-race');
    finish(true); // what the database said before the revoke was written
    expect(await inFlight).to.equal(null);
    expect(await verifyBearerCredential(token)).to.equal(null);
  });

  it("a lookup in flight during another grant's revoke still answers, but isn't kept", async () => {
    const { asked, finish } = holdFirstLookup();
    const token = await tokenWith({ gid: 'g-other' });
    const inFlight = verifyBearerCredential(token);
    await asked;
    grants.revoked('g-unrelated');
    finish(true);
    expect(await inFlight).to.not.equal(null);
    await verifyBearerCredential(token);
    expect(lookup.callCount).to.equal(2);
  });

  it('throws when the grant lookup fails, and keeps nothing', async () => {
    lookup.onFirstCall().rejects(new Error('db down'));
    const token = await tokenWith({ gid: 'g-db' });
    let caught: unknown;
    await verifyBearerCredential(token).catch((err) => (caught = err));
    expect(String(caught)).to.match(/db down/);
    expect(await verifyBearerCredential(token)).to.not.equal(null);
    expect(lookup.callCount).to.equal(2);
  });

  describe('a session token under a grant (xenon_session_capabilities)', () => {
    const sessionToken = (claims: Record<string, unknown> = {}) =>
      keys.sign(
        { sub: 'u1', scopes: 'sessions', ...claims },
        { audience: 'xenon-session', ttlSeconds: 600 },
      );

    it('is a wrong token once its grant is revoked', async () => {
      const token = await sessionToken({ gid: 'g-session' });
      expect((await verifySessionTokenCredential(token)).user.id).to.equal('u1');
      grants.revoked('g-session');
      let caught: unknown;
      await verifySessionTokenCredential(token).catch((err) => (caught = err));
      expect(caught).to.be.instanceOf(SessionTokenGrantRevokedError);
      expect(isWrongSessionToken(caught)).to.equal(true);
    });

    it('without gid asks no grant', async () => {
      await verifySessionTokenCredential(await sessionToken());
      expect(lookup.called).to.equal(false);
    });

    it("is refused by per-command auth's cache at once when its grant is revoked", async () => {
      const verifier = new CommandCallerVerifier();
      const credential = {
        kind: 'session-token' as const,
        token: await sessionToken({ gid: 'g-session-cmd' }),
      };
      expect((await verifier.verify(credential)).valid).to.equal(true);
      expect((await verifier.verify(credential)).valid).to.equal(true);
      grants.revoked('g-session-cmd');
      expect((await verifier.verify(credential)).valid).to.equal(false);
    });
  });

  describe('resolveMcpCaller', () => {
    const reqWith = (token: string) =>
      ({ headers: { authorization: `Bearer ${token}` } }) as unknown as Request;

    it("sets grantId from the token's gid", async () => {
      const caller = await resolveMcpCaller(reqWith(await tokenWith({ gid: 'g-mcp' })));
      expect(caller).to.be.an('object');
      expect((caller as any).grantId).to.equal('g-mcp');
      expect((caller as any).auth.userId).to.equal('u1');
    });

    it('sets no grantId for a token without gid', async () => {
      const caller = await resolveMcpCaller(reqWith(await tokenWith()));
      expect(caller).to.be.an('object');
      expect(caller).to.not.have.property('grantId');
    });

    it('is unauthenticated for a revoked grant, and unavailable when the lookup fails', async () => {
      grants.revoked('g-mcp-revoked');
      expect(await resolveMcpCaller(reqWith(await tokenWith({ gid: 'g-mcp-revoked' })))).to.equal(
        'unauthenticated',
      );
      lookup.rejects(new Error('db down'));
      expect(await resolveMcpCaller(reqWith(await tokenWith({ gid: 'g-mcp-db' })))).to.equal(
        'unavailable',
      );
    });
  });

  describe("per-command auth's cache", () => {
    it('refuses a remembered token at once when its grant is revoked', async () => {
      const verifier = new CommandCallerVerifier();
      const credential = { kind: 'bearer' as const, token: await tokenWith({ gid: 'g-cmd' }) };
      expect((await verifier.verify(credential)).valid).to.equal(true);
      expect((await verifier.verify(credential)).valid).to.equal(true);
      grants.revoked('g-cmd');
      expect((await verifier.verify(credential)).valid).to.equal(false);
    });

    it('throws on a remembered token when its grant cannot be checked', async () => {
      const verifier = new CommandCallerVerifier();
      const credential = { kind: 'bearer' as const, token: await tokenWith({ gid: 'g-cmd-db' }) };
      expect((await verifier.verify(credential)).valid).to.equal(true);
      clock += LIVE_GRANT_TTL_MS;
      lookup.rejects(new Error('db down'));
      let caught: unknown;
      await verifier.verify(credential).catch((err) => (caught = err));
      expect(String(caught)).to.match(/db down/);
    });

    it('a remembered token without gid asks nothing', async () => {
      const verifier = new CommandCallerVerifier();
      const credential = { kind: 'bearer' as const, token: await tokenWith() };
      await verifier.verify(credential);
      await verifier.verify(credential);
      expect(lookup.called).to.equal(false);
    });
  });
});
