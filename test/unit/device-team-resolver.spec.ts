import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import {
  DeviceTeamResolver,
  DEVICE_TEAM_TTL_MS,
  DEVICE_TEAM_LOOKUP_TIMEOUT_MS,
  canSeeDeviceTeam,
} from '../../src/services/device-access/DeviceTeamResolver';

const H1 = 'http://h1:4723';
const H2 = 'http://h2:4723';

/**
 * A lookup that answers from `rows` and counts its calls. `rows[udid]` of
 * undefined means the store has no such device; an object is that udid's one
 * row (on H1 unless it names a host), an array is every row of the udid, and
 * a function value is called, so a test can make one lookup throw or hang.
 */
function countingLookup(rows: Record<string, any>) {
  const calls: string[] = [];
  const findRows = async (udid: string) => {
    calls.push(udid);
    const value = rows[udid];
    const found = typeof value === 'function' ? await value() : value;
    if (found === undefined || found === null) return [];
    return (Array.isArray(found) ? found : [found]).map((row: any) => ({ host: H1, ...row }));
  };
  return { calls, findRows };
}

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

// The team rule itself is isDeviceVisible, tested in device-team-guard.spec.ts.
describe('canSeeDeviceTeam — an unknown device fails closed', () => {
  it('a known device follows the team rule (isDeviceVisible)', () => {
    expect(canSeeDeviceTeam({ known: true, teamId: 'team-a' }, ['team-a'])).to.equal(true);
    expect(canSeeDeviceTeam({ known: true, teamId: 'team-b' }, ['team-a'])).to.equal(false);
    expect(canSeeDeviceTeam({ known: true, teamId: null }, [])).to.equal(true);
  });

  it('an unknown device is hidden from every member, and shown to an unscoped caller', () => {
    expect(canSeeDeviceTeam({ known: false }, ['team-a'])).to.equal(false);
    expect(canSeeDeviceTeam({ known: false }, [])).to.equal(false);
    expect(canSeeDeviceTeam({ known: false }, undefined)).to.equal(true);
  });
});

describe('DeviceTeamResolver', () => {
  it('resolves a udid to its team from the device store', async () => {
    const { findRows } = countingLookup({
      'phone-a': { teamId: 'team-a' },
      'phone-s': { teamId: null },
    });
    const r = new DeviceTeamResolver({ findRows });
    expect(await r.resolve('phone-a')).to.deep.equal({ known: true, teamId: 'team-a' });
    expect(await r.resolve('phone-s')).to.deep.equal({ known: true, teamId: null });
  });

  it('a row without a teamId field is the shared pool', async () => {
    const { findRows } = countingLookup({ 'phone-x': { udid: 'phone-x' } });
    const r = new DeviceTeamResolver({ findRows });
    expect(await r.resolve('phone-x')).to.deep.equal({ known: true, teamId: null });
  });

  it('an unknown udid resolves to unknown (hidden from non-admins)', async () => {
    const { findRows } = countingLookup({});
    const r = new DeviceTeamResolver({ findRows });
    expect(await r.resolve('ghost')).to.deep.equal({ known: false });
  });

  it('an empty or missing udid is unknown without asking the store', async () => {
    const { calls, findRows } = countingLookup({});
    const r = new DeviceTeamResolver({ findRows });
    expect(await r.resolve('')).to.deep.equal({ known: false });
    expect(await r.resolve(undefined)).to.deep.equal({ known: false });
    expect(await r.resolve(null)).to.deep.equal({ known: false });
    expect(calls).to.deep.equal([]);
  });

  it('asks the store once per udid within the TTL, however many events there are', async () => {
    const c = clock();
    const { calls, findRows } = countingLookup({ 'phone-a': { teamId: 'team-a' } });
    const r = new DeviceTeamResolver({ findRows, now: c.now });
    for (let i = 0; i < 50; i++) {
      await r.resolve('phone-a');
      c.t += 50; // 50 commands, 2.5 s in all
    }
    expect(calls).to.deep.equal(['phone-a']);
  });

  it('concurrent lookups of one udid share a single store call', async () => {
    const { calls, findRows } = countingLookup({ 'phone-a': { teamId: 'team-a' } });
    const r = new DeviceTeamResolver({ findRows });
    const teams = await Promise.all([
      r.resolve('phone-a'),
      r.resolve('phone-a'),
      r.resolve('phone-a'),
    ]);
    expect(calls).to.have.length(1);
    teams.forEach((t: unknown) => expect(t).to.deep.equal({ known: true, teamId: 'team-a' }));
  });

  it('asks again once the TTL has passed, so a team change reaches it', async () => {
    const c = clock();
    const rows: Record<string, any> = { 'phone-a': { teamId: 'team-a' } };
    const { calls, findRows } = countingLookup(rows);
    const r = new DeviceTeamResolver({ findRows, now: c.now });
    await r.resolve('phone-a');
    rows['phone-a'] = { teamId: 'team-b' };
    c.t += DEVICE_TEAM_TTL_MS - 1;
    expect(await r.resolve('phone-a')).to.deep.equal({ known: true, teamId: 'team-a' });
    c.t += 1;
    expect(await r.resolve('phone-a')).to.deep.equal({ known: true, teamId: 'team-b' });
    expect(calls).to.have.length(2);
  });

  it('keeps a "few seconds" TTL', () => {
    expect(DEVICE_TEAM_TTL_MS).to.be.within(1_000, 10_000);
  });

  it('remembers an unknown udid for the TTL too, so a stray session costs no query per command', async () => {
    const c = clock();
    const { calls, findRows } = countingLookup({});
    const r = new DeviceTeamResolver({ findRows, now: c.now });
    for (let i = 0; i < 10; i++) await r.resolve('ghost');
    expect(calls).to.have.length(1);
  });

  it('a device event refreshes it: note() replaces the cached team without a lookup', async () => {
    const { calls, findRows } = countingLookup({ 'phone-a': { teamId: 'team-a' } });
    const r = new DeviceTeamResolver({ findRows });
    await r.resolve('phone-a', H1);
    r.note('phone-a', H1, 'team-b');
    expect(await r.resolve('phone-a', H1)).to.deep.equal({ known: true, teamId: 'team-b' });
    expect(calls).to.have.length(1);
  });

  it('note() turns a remembered unknown into a known device (device_added)', async () => {
    const { calls, findRows } = countingLookup({});
    const r = new DeviceTeamResolver({ findRows });
    expect(await r.resolve('new-phone', H1)).to.deep.equal({ known: false });
    r.note('new-phone', H1, null);
    expect(await r.resolve('new-phone', H1)).to.deep.equal({ known: true, teamId: null });
    expect(calls).to.have.length(1);
  });

  it('a lookup that lands after note() does not overwrite the fresher answer', async () => {
    let release!: (row: any) => void;
    const findRows = () => new Promise<any>((res) => (release = res));
    const r = new DeviceTeamResolver({ findRows });
    const first = r.resolve('phone-a', H1);
    r.note('phone-a', H1, 'team-b');
    release([{ host: H1, teamId: 'team-a' }]);
    expect(await first).to.deep.equal({ known: true, teamId: 'team-a' });
    expect(await r.resolve('phone-a', H1)).to.deep.equal({ known: true, teamId: 'team-b' });
  });

  it('a failed lookup hides the device (fail closed) and is not remembered', async () => {
    let fail = true;
    const { calls, findRows } = countingLookup({
      'phone-a': () => {
        if (fail) throw new Error('db down');
        return { teamId: 'team-a' };
      },
    });
    const r = new DeviceTeamResolver({ findRows });
    expect(await r.resolve('phone-a')).to.deep.equal({ known: false });
    fail = false;
    expect(await r.resolve('phone-a')).to.deep.equal({ known: true, teamId: 'team-a' });
    expect(calls).to.have.length(2);
  });

  it('a lookup that outlasts the timeout resolves to unknown, and is not remembered', async () => {
    let hang = true;
    const calls: string[] = [];
    const r = new DeviceTeamResolver({
      findRows: (udid: string) => {
        calls.push(udid);
        return hang
          ? new Promise(() => undefined)
          : Promise.resolve([{ host: H1, teamId: 'team-a' }]);
      },
      lookupTimeoutMs: 20,
    });
    const started = Date.now();
    expect(await r.resolve('phone-a')).to.deep.equal({ known: false });
    expect(Date.now() - started).to.be.lessThan(1_000);
    hang = false;
    expect(await r.resolve('phone-a')).to.deep.equal({ known: true, teamId: 'team-a' });
    expect(calls).to.have.length(2);
  });

  it('a lookup inside the timeout is answered normally', async () => {
    const r = new DeviceTeamResolver({
      findRows: () =>
        new Promise((res) => setTimeout(() => res([{ host: H1, teamId: 'team-b' }]), 5)),
      lookupTimeoutMs: 200,
    });
    expect(await r.resolve('phone-b')).to.deep.equal({ known: true, teamId: 'team-b' });
  });

  it('times out after a few seconds by default', () => {
    expect(DEVICE_TEAM_LOOKUP_TIMEOUT_MS).to.be.within(1_000, 5_000);
  });

  describe('by udid and host: a udid two servers report is two phones', () => {
    const UDID = 'emulator-5554';
    const BOTH = {
      [UDID]: [
        { host: H1, teamId: 'A' },
        { host: H2, teamId: 'B' },
      ],
    };

    it("resolves each host to its own row's team", async () => {
      const { findRows } = countingLookup(BOTH);
      const r = new DeviceTeamResolver({ findRows });
      expect(await r.resolve(UDID, H1)).to.deep.equal({ known: true, teamId: 'A' });
      expect(await r.resolve(UDID, H2)).to.deep.equal({ known: true, teamId: 'B' });
    });

    it('a host no row of the udid has is unknown', async () => {
      const { findRows } = countingLookup(BOTH);
      const r = new DeviceTeamResolver({ findRows });
      expect(await r.resolve(UDID, 'http://h3:4723')).to.deep.equal({ known: false });
    });

    it('without a host, two rows are unknown (admins only), as findPhone finds them ambiguous', async () => {
      const { findRows } = countingLookup(BOTH);
      const r = new DeviceTeamResolver({ findRows });
      expect(await r.resolve(UDID)).to.deep.equal({ known: false });
    });

    it("without a host, one row is that phone's team", async () => {
      const { findRows } = countingLookup({ [UDID]: [{ host: H1, teamId: 'A' }] });
      const r = new DeviceTeamResolver({ findRows });
      expect(await r.resolve(UDID)).to.deep.equal({ known: true, teamId: 'A' });
    });

    it('caches each host apart', async () => {
      const { calls, findRows } = countingLookup(BOTH);
      const r = new DeviceTeamResolver({ findRows });
      await r.resolve(UDID, H1);
      await r.resolve(UDID, H1);
      await r.resolve(UDID, H2);
      expect(calls).to.deep.equal([UDID, UDID]);
    });

    it("note() answers that host's resolve with no lookup, and drops the udid's host-less answer", async () => {
      const rows: Record<string, any> = { [UDID]: [{ host: H1, teamId: 'A' }] };
      const { calls, findRows } = countingLookup(rows);
      const r = new DeviceTeamResolver({ findRows });
      expect(await r.resolve(UDID)).to.deep.equal({ known: true, teamId: 'A' });
      expect(calls).to.have.length(1);

      rows[UDID] = [{ host: H1, teamId: 'C' }];
      r.note(UDID, H1, 'C');
      expect(await r.resolve(UDID, H1)).to.deep.equal({ known: true, teamId: 'C' });
      expect(calls, 'the host is answered from the note').to.have.length(1);

      expect(await r.resolve(UDID)).to.deep.equal({ known: true, teamId: 'C' });
      expect(calls, 'the host-less answer is looked up again').to.have.length(2);
    });

    it("note() leaves the udid's other hosts as they were", async () => {
      const { calls, findRows } = countingLookup(BOTH);
      const r = new DeviceTeamResolver({ findRows });
      await r.resolve(UDID, H2);
      r.note(UDID, H1, 'C');
      expect(await r.resolve(UDID, H2)).to.deep.equal({ known: true, teamId: 'B' });
      expect(calls).to.have.length(1);
    });
  });

  it('builds through Container.get (TypeDI must not try to inject the deps object)', () => {
    expect(() => Container.get(DeviceTeamResolver)).not.to.throw();
  });
});
