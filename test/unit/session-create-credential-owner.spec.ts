import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { UserService } from '../../src/services/UserService';
import { config } from '../../src/config';
import { prisma } from '../../src/prisma';
import { saveRegistrations } from '../helpers/container-registration';
import { takeSessionCredentials } from '../../src/services/session/sessionCredentials';

/**
 * Session create judges the credentials it is given by REST's rule: a key
 * pair or session token says who the caller is only while that user exists
 * and is ACTIVE. Through 2.14 the pair was checked against the key alone
 * (ApiKeyService.verifyPair) and the session token against its signature
 * alone, so a user set to Inactive, or deleted, kept creating sessions as
 * themselves, past XENON_REQUIRE_SESSION_TOKEN too.
 *
 * Such credentials now count as wrong ones: with the gate on the session is
 * refused, with it off it runs with no owner, like any session presenting
 * credentials that don't check out.
 *
 * A session token also has to carry the `sessions` scope, as a key pair
 * must: POST /auth/token gave one to any credential, a read-only one
 * included.
 */

// authorizeSessionRequest is private: the single place a create's identity is
// decided. It is handed the credentials createSession took out of the caps.
const invoke = (svc: any, caps: any) =>
  svc.authorizeSessionRequest(caps, takeSessionCredentials(caps));

const capsWith = (options: Record<string, unknown>) => ({
  alwaysMatch: { 'xe:options': options },
  firstMatch: [{}],
});

async function refusalOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err: any) {
    return String(err?.message ?? err);
  }
}

describe('session create: the credentials of an inactive or deleted user', () => {
  let svc: any;
  let dir: string;
  let keys: JwtKeyService;
  let restore: () => void;
  let authDisabledBefore: boolean;
  let gateBefore: string | undefined;
  let users: Record<string, { id: string; role: string; status: string } | undefined>;
  let findById: sinon.SinonStub;

  const keyRow = { id: 'key_alice', userId: 'usr_alice', scopes: 'sessions', teamId: null };
  const alice = () => users.usr_alice as { id: string; role: string; status: string };
  const pair = () => capsWith({ accessKey: 'xen_alice', token: 'tk' });
  const token = (claims: Record<string, unknown> = { sub: 'usr_alice', scopes: 'sessions' }) =>
    keys.sign(claims, { audience: 'xenon-session', ttlSeconds: 600 });

  const gate = (on: boolean) => {
    if (on) process.env.XENON_REQUIRE_SESSION_TOKEN = 'true';
    else delete process.env.XENON_REQUIRE_SESSION_TOKEN;
  };

  beforeEach(async () => {
    authDisabledBefore = config.authDisabled;
    config.authDisabled = false;
    gateBefore = process.env.XENON_REQUIRE_SESSION_TOKEN;
    restore = saveRegistrations(ApiKeyService, JwtKeyService, UserService);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-create-owner-'));
    keys = new JwtKeyService();
    await keys.init(dir);
    Container.set(JwtKeyService, keys);
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves(keyRow),
      hasScope: (row: any, req: string[]) => {
        const owned = row.scopes.split(',');
        return owned.includes('admin') || req.some((s: string) => owned.includes(s));
      },
    } as any);
    users = { usr_alice: { id: 'usr_alice', role: 'MEMBER', status: 'ACTIVE' } };
    findById = sinon.stub().callsFake(async (id: string) => users[id] ?? null);
    Container.set(UserService, { findById } as any);
    sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);
    svc = new SessionLifecycleService();
  });

  afterEach(() => {
    config.authDisabled = authDisabledBefore;
    if (gateBefore === undefined) delete process.env.XENON_REQUIRE_SESSION_TOKEN;
    else process.env.XENON_REQUIRE_SESSION_TOKEN = gateBefore;
    sinon.restore();
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('with XENON_REQUIRE_SESSION_TOKEN on', () => {
    beforeEach(() => gate(true));

    it("refuses an Inactive user's access key and token", async () => {
      alice().status = 'INACTIVE';
      expect(await refusalOf(invoke(svc, pair()))).to.match(/session rejected/);
    });

    it("refuses a deleted user's key, whose row outlived them", async () => {
      users.usr_alice = undefined;
      expect(await refusalOf(invoke(svc, pair()))).to.match(/session rejected/);
    });

    it("refuses an Inactive user's session token", async () => {
      alice().status = 'INACTIVE';
      const caps = capsWith({ sessionToken: await token() });
      expect(await refusalOf(invoke(svc, caps))).to.match(/session rejected/);
    });

    it("refuses a deleted user's session token, which is still within its lifetime", async () => {
      users.usr_alice = undefined;
      const caps = capsWith({ sessionToken: await token() });
      expect(await refusalOf(invoke(svc, caps))).to.match(/session rejected/);
    });

    it("still admits an Active user's key and token, and their session token", async () => {
      const byPair = await invoke(svc, pair());
      expect(byPair).to.include({ apiKeyId: 'key_alice', userId: 'usr_alice' });
      const byToken = await invoke(svc, capsWith({ sessionToken: await token() }));
      expect(byToken).to.include({ apiKeyId: null, userId: 'usr_alice' });
    });

    it('looks the owner up once, though the gate and attribution both verify the token', async () => {
      await invoke(svc, capsWith({ sessionToken: await token() }));
      expect(findById.callCount).to.equal(1);
    });
  });

  describe('with XENON_REQUIRE_SESSION_TOKEN off', () => {
    beforeEach(() => gate(false));

    it("gives no owner to a session made with an Inactive user's key", async () => {
      alice().status = 'INACTIVE';
      const res = await invoke(svc, pair());
      expect(res).to.include({ apiKeyId: null, userId: null });
    });

    it("gives no owner to a session made with a deleted user's session token", async () => {
      users.usr_alice = undefined;
      const res = await invoke(svc, capsWith({ sessionToken: await token() }));
      expect(res).to.include({ apiKeyId: null, userId: null });
    });

    it('looks an Active owner up once for a key and token', async () => {
      const res = await invoke(svc, pair());
      await res.leaseAccess();
      expect(res.userId).to.equal('usr_alice');
      expect(findById.callCount).to.equal(1);
    });
  });

  describe('a session token needs the `sessions` scope', () => {
    for (const on of [false, true]) {
      describe(`(gate ${on ? 'on' : 'off'})`, () => {
        beforeEach(() => gate(on));

        it('refuses one minted for a read-only credential', async () => {
          const caps = capsWith({
            sessionToken: await token({ sub: 'usr_alice', scopes: 'devices' }),
          });
          expect(await refusalOf(invoke(svc, caps))).to.match(/sessions` scope/);
        });

        it('refuses one minted before session tokens carried their scopes', async () => {
          const caps = capsWith({ sessionToken: await token({ sub: 'usr_alice' }) });
          expect(await refusalOf(invoke(svc, caps))).to.match(/sessions` scope/);
        });

        it('admits one with `sessions` or `admin`', async () => {
          for (const scopes of ['sessions', 'admin', 'devices,sessions']) {
            const caps = capsWith({ sessionToken: await token({ sub: 'usr_alice', scopes }) });
            expect((await invoke(svc, caps)).userId).to.equal('usr_alice');
          }
        });
      });
    }
  });

  // Taking over a lease someone else created is an ownership override: a
  // SUPER_ADMIN, or a credential with the `admin` scope. A session token was
  // judged by its user's role alone, so an ADMIN's key without the admin
  // scope, which may not override, minted a session token that could.
  describe('a session token overrides a lease only as the credential that minted it could', () => {
    beforeEach(() => gate(false));
    const overrideWith = async (role: string, scopes: string) => {
      alice().role = role;
      const caps = capsWith({ sessionToken: await token({ sub: 'usr_alice', scopes }) });
      return (await (await invoke(svc, caps)).leaseAccess()).canOverride;
    };

    it("is refused for an ADMIN's token minted without the admin scope", async () => {
      expect(await overrideWith('ADMIN', 'sessions')).to.equal(false);
    });

    it("is allowed for an ADMIN's token minted with it, and for a SUPER_ADMIN's", async () => {
      expect(await overrideWith('ADMIN', 'admin,sessions')).to.equal(true);
      expect(await overrideWith('SUPER_ADMIN', 'sessions')).to.equal(true);
    });

    it("is refused for a member's token", async () => {
      expect(await overrideWith('MEMBER', 'sessions')).to.equal(false);
    });
  });
});
