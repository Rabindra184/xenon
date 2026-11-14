import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import {
  LEFTOVER_MAX_AGE_MS,
  PhoneNetworkLedger,
} from '../../../src/services/network/PhoneNetworkLedger';
import { PhoneNetworkRestore } from '../../../src/services/network/PhoneNetworkRestore';
import { NetworkConditioningService } from '../../../src/services/NetworkConditioningService';
import { InterceptorService } from '../../../src/services/InterceptorService';
import { prisma } from '../../../src/prisma';
import { saveRegistrations } from '../../helpers/container-registration';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { FakeAdb, fakeAdb, useFakeAdb } from '../../helpers/fake-adb';

const DAY = 24 * 60 * 60 * 1000;

const raw = async (sessionId: string) =>
  (await prisma.webConfig.findUnique({ where: { name: `phone-network:${sessionId}` } }))?.value;

const put = (sessionId: string, value: unknown) =>
  prisma.webConfig.create({
    data: {
      id: `phone-network:${sessionId}`,
      name: `phone-network:${sessionId}`,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    },
  });

/**
 * The ledger's rows say which version wrote them (`v: 1`). A row this
 * release can't read, from a later release (a downgrade) or naming a part it
 * doesn't know, is kept for the release that wrote it, not deleted: through
 * 2.36 boot dropped every row it couldn't parse, and with it the record of
 * a phone left offline.
 */
describe('PhoneNetworkLedger: versioned rows', function () {
  this.timeout(60_000);
  useScratchDatabase();
  let adb: FakeAdb;
  useFakeAdb(() => adb);
  let ledger: PhoneNetworkLedger;
  let restoreRegs: () => void;

  beforeEach(async () => {
    adb = fakeAdb();
    restoreRegs = saveRegistrations(NetworkConditioningService, InterceptorService);
    const idle = { has: () => false, sessionIds: () => [], hasCapture: () => false };
    Container.set(NetworkConditioningService, idle as any);
    Container.set(InterceptorService, idle as any);
    ledger = new PhoneNetworkLedger();
    await prisma.webConfig.deleteMany({ where: { name: { startsWith: 'phone-network:' } } });
  });

  afterEach(() => {
    sinon.restore();
    restoreRegs();
  });

  it('writes v: 1 on every row', async () => {
    await ledger.note('s1', 'P1', { offline: { wifiOn: true, dataOn: true } });
    expect(JSON.parse((await raw('s1')) ?? '{}').v).to.equal(1);
    await ledger.note('s1', 'P1', { proxy: { set: '127.0.0.1:11150', previous: null } });
    expect(JSON.parse((await raw('s1')) ?? '{}').v).to.equal(1);
  });

  it('reads a row without a version as before (2.36 and earlier)', async () => {
    await put('old', { sessionId: 'old', udid: 'P1', at: Date.now(), offline: { wifiOn: true } });
    const [entry] = await ledger.list();
    expect(entry).to.include({ sessionId: 'old', udid: 'P1' });
    expect(entry.offline).to.deep.equal({ wifiOn: true, dataOn: null });
  });

  it('keeps a row from a later version, unread, and says so once', async () => {
    const later = { v: 2, sessionId: 'later', udid: 'P1', at: Date.now(), radios: { x: 1 } };
    await put('later', later);
    const warn = sinon.spy((ledger as any).logger, 'warn');

    expect(await ledger.list()).to.deep.equal([]);
    expect(await ledger.list()).to.deep.equal([]);

    expect(JSON.parse((await raw('later')) ?? '{}')).to.deep.equal(later);
    const about = warn.args.filter((a) => String(a[0]).includes('later'));
    expect(about, warn.args.map((a) => a[0]).join('\n')).to.have.length(1);
  });

  it('keeps a v: 1 row naming a part this release does not know', async () => {
    const row = {
      v: 1,
      sessionId: 'odd',
      udid: 'P1',
      at: Date.now(),
      offline: { wifiOn: true, dataOn: true },
      bluetooth: { on: false },
    };
    await put('odd', row);

    expect(await ledger.list()).to.deep.equal([]);
    expect(JSON.parse((await raw('odd')) ?? '{}')).to.deep.equal(row);
    // Nor is the part it can read undone, which would settle the row.
    expect(await new PhoneNetworkRestore().restoreLeftovers({})).to.equal(0);
    expect(adb.calls).to.deep.equal([]);
    expect(await raw('odd')).to.not.equal(undefined);
  });

  it('drops an unreadable row once it is older than a week', async () => {
    await put('stale', { v: 7, sessionId: 'stale', udid: 'P1', at: Date.now() - 8 * DAY });
    expect(8 * DAY).to.be.greaterThan(LEFTOVER_MAX_AGE_MS);
    await ledger.list();
    expect(await raw('stale')).to.equal(undefined);
  });

  it('still drops a row without a version that is not a record', async () => {
    await put('junk', 'not json');
    await put('empty', { sessionId: 'empty', udid: 'P1', at: Date.now() });
    expect(await ledger.list()).to.deep.equal([]);
    expect(await raw('junk')).to.equal(undefined);
    expect(await raw('empty')).to.equal(undefined);
  });
});
