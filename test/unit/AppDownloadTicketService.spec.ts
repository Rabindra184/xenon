import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { StreamTicketService } from '../../src/services/token/StreamTicketService';
import {
  AppDownloadTicketService,
  APP_TICKET_TTL_SEC,
} from '../../src/services/token/AppDownloadTicketService';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * The ticket an Appium driver presents to download an uploaded app. The driver
 * sends no credentials, so the ticket is the whole of its authority: one app,
 * once, for a few minutes, and never usable as a stream ticket or vice versa.
 */
describe('AppDownloadTicketService', () => {
  let dir: string;
  let svc: AppDownloadTicketService;
  let streams: StreamTicketService;
  let restore: () => void;

  beforeEach(async () => {
    restore = saveRegistrations(JwtKeyService);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-app-ticket-'));
    const keys = new JwtKeyService();
    await keys.init(dir);
    Container.set(JwtKeyService, keys);
    svc = new AppDownloadTicketService();
    streams = new StreamTicketService();
  });
  afterEach(() => {
    sinon.restore();
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function refusal(fn: () => Promise<unknown>): Promise<string> {
    try {
      await fn();
    } catch (e: any) {
      return String(e?.message);
    }
    return 'accepted';
  }

  it('lasts ten minutes', () => {
    expect(APP_TICKET_TTL_SEC).to.equal(600);
  });

  it('redeems once for the app it names', async () => {
    const t = await svc.mint('app-A');
    await svc.redeem(t, 'app-A');
  });

  it('refuses another app', async () => {
    const t = await svc.mint('app-A');
    expect(await refusal(() => svc.redeem(t, 'app-B'))).to.match(/app mismatch/);
    // A refused attempt does not spend it: the right app still redeems.
    await svc.redeem(t, 'app-A');
  });

  it('refuses a second use', async () => {
    const t = await svc.mint('app-A');
    await svc.redeem(t, 'app-A');
    expect(await refusal(() => svc.redeem(t, 'app-A'))).to.match(/already used/);
  });

  it('refuses an expired ticket', async () => {
    const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const t = await svc.mint('app-A');
    // Past the TTL and the verifier's 60 s clock tolerance.
    clock.tick((APP_TICKET_TTL_SEC + 61) * 1000);
    expect(await refusal(() => svc.redeem(t, 'app-A'))).to.match(/exp/);
  });

  it('refuses a replay after the TTL while the token still verifies', async () => {
    const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const t = await svc.mint('app-A');
    await svc.redeem(t, 'app-A');
    clock.tick((APP_TICKET_TTL_SEC + 30) * 1000); // inside exp + tolerance
    expect(await refusal(() => svc.redeem(t, 'app-A'))).to.match(/already used/);
  });

  it('refuses a stream ticket, even one whose udid is the app id', async () => {
    const t = await streams.mint('app-A', 'actor-1', { isAdmin: true });
    expect(await refusal(() => svc.redeem(t, 'app-A'))).to.match(/aud/);
  });

  it('is refused as a stream ticket', async () => {
    const t = await svc.mint('UDID-1');
    expect(await refusal(() => streams.redeem(t, 'UDID-1'))).to.match(/aud/);
  });
});
