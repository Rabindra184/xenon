import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import {
  assertSessionTokenGate,
  sessionTokenGateEnabled,
} from '../../src/services/sessionTokenGate';

describe('sessionTokenGate', () => {
  let svc: JwtKeyService;
  let valid: string;

  before(async () => {
    svc = Container.get(JwtKeyService);
    // Reuse the instance initialized by other specs if present; init is idempotent
    await svc.init(fs.mkdtempSync(path.join(os.tmpdir(), 'jwtkeys-gate-')));
    valid = await svc.sign({ sub: 'u1' }, { audience: 'xenon-session', ttlSeconds: 60 });
  });

  const verify = (t: string) => svc.verify(t, { audience: 'xenon-session' });

  it('flag parsing accepts 1/true/yes/on case-insensitively', () => {
    for (const v of ['1', 'true', 'YES', 'On']) {
      expect(sessionTokenGateEnabled({ XENON_REQUIRE_SESSION_TOKEN: v } as any)).to.equal(true);
    }
    for (const v of [undefined, '', '0', 'false', 'off']) {
      expect(sessionTokenGateEnabled({ XENON_REQUIRE_SESSION_TOKEN: v } as any)).to.equal(false);
    }
  });

  it('disabled gate always passes', async () => {
    await assertSessionTokenGate({ enabled: false, hasValidKeyPair: false, token: null, verify });
  });

  it('enabled gate passes with a valid df:options key pair (SDK back-compat)', async () => {
    await assertSessionTokenGate({ enabled: true, hasValidKeyPair: true, token: null, verify });
  });

  it('enabled gate passes with a valid xenon-session token', async () => {
    await assertSessionTokenGate({ enabled: true, hasValidKeyPair: false, token: valid, verify });
  });

  it('enabled gate rejects a missing token', async () => {
    try {
      await assertSessionTokenGate({ enabled: true, hasValidKeyPair: false, token: null, verify });
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).to.include('xenon:options.sessionToken');
    }
  });

  it('enabled gate rejects a wrong-audience token', async () => {
    const wrongAud = await svc.sign({ sub: 'u1' }, { audience: 'xenon-rest', ttlSeconds: 60 });
    try {
      await assertSessionTokenGate({ enabled: true, hasValidKeyPair: false, token: wrongAud, verify });
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).to.include('invalid');
    }
  });

  it('enabled gate rejects garbage tokens', async () => {
    try {
      await assertSessionTokenGate({ enabled: true, hasValidKeyPair: false, token: 'garbage', verify });
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.message).to.include('invalid');
    }
  });
});
