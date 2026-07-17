import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { StreamTicketService } from '../../src/services/token/StreamTicketService';

describe('StreamTicketService', () => {
  let dir: string;
  let svc: StreamTicketService;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-ticket-'));
    const keys = new JwtKeyService();
    await keys.init(dir);
    Container.set(JwtKeyService, keys);
    svc = new StreamTicketService();
  });
  afterEach(() => {
    Container.reset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('mints and redeems a ticket once for the bound udid', async () => {
    const t = await svc.mint('UDID-1', 'actor-1');
    const out = await svc.redeem(t, 'UDID-1');
    expect(out.actorId).to.equal('actor-1');
  });

  it('rejects redemption for a different udid', async () => {
    const t = await svc.mint('UDID-1', 'actor-1');
    try {
      await svc.redeem(t, 'UDID-2');
      expect.fail('should throw');
    } catch (e: any) {
      expect(e.message).to.match(/udid/);
    }
  });

  it('rejects second redemption (single-use)', async () => {
    const t = await svc.mint('UDID-1', 'actor-1');
    await svc.redeem(t, 'UDID-1');
    try {
      await svc.redeem(t, 'UDID-1');
      expect.fail('should throw');
    } catch (e: any) {
      expect(e.message).to.match(/used/);
    }
  });

  // Regression for the replay window: JwtKeyService.verify honors
  // clockTolerance:60, so a 60s ticket stays *verifiable* until mint+120s.
  // If the anti-replay entry evicts at redeem-time+TTL (mint+60s) instead of
  // token-exp+tolerance (mint+120s), a replay at ~mint+90s slips through:
  // verify() still accepts it, the prune loop has already dropped the jti, and
  // `used.has(jti)` is false → REPLAY ACCEPTED. This test advances the clock
  // ~90s (past TTL, still within exp+tolerance) and asserts single-use holds.
  // It fails under redeem-time+TTL eviction and passes under exp+tolerance.
  it('rejects a replay after TTL but within verify clock tolerance (advanced clock)', async () => {
    const clock = sinon.useFakeTimers({ now: 0, toFake: ['Date'] });
    let err: Error | undefined;
    try {
      const t = await svc.mint('UDID-1', 'actor-1');
      await svc.redeem(t, 'UDID-1'); // legitimate first use at ~t=0
      clock.tick(90_000); // t≈90s: past 60s TTL, still < mint+120s verify window
      try {
        await svc.redeem(t, 'UDID-1');
      } catch (e: any) {
        err = e;
      }
    } finally {
      clock.restore();
    }
    // Assert OUTSIDE the try so a wrongly-accepted replay (err === undefined)
    // fails loudly instead of being swallowed. Note: the failure message here
    // must NOT contain the word matched below, or a vacuous pass sneaks back in.
    expect(err, 'replay was accepted — single-use bypassed').to.be.an('error');
    expect(String(err && err.message)).to.match(/already used/);
  });
});
