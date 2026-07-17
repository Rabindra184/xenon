import 'reflect-metadata';
import { expect } from 'chai';
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
});
