import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import {
  DeviceTeamResolver,
  DEVICE_TEAM_TTL_MS,
  canSeeDeviceTeam,
} from '../../src/services/device-access/DeviceTeamResolver';

/**
 * A lookup that answers from `rows` and counts its calls. `rows[udid]` of
 * undefined means the store has no such device; a function value is called,
 * so a test can make one lookup throw or hang.
 */
function countingLookup(rows: Record<string, any>) {
  const calls: string[] = [];
  const findDevice = async (udid: string) => {
    calls.push(udid);
    const row = rows[udid];
    return typeof row === 'function' ? row() : row;
  };
  return { calls, findDevice };
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
    const { findDevice } = countingLookup({
      'phone-a': { teamId: 'team-a' },
      'phone-s': { teamId: null },
    });
    const r = new DeviceTeamResolver({ findDevice });
    expect(await r.resolve('phone-a')).to.deep.equal({ known: true, teamId: 'team-a' });
    expect(await r.resolve('phone-s')).to.deep.equal({ known: true, teamId: null });
  });

  it('a row without a teamId field is the shared pool', async () => {
    const { findDevice } = countingLookup({ 'phone-x': { udid: 'phone-x' } });
    const r = new DeviceTeamResolver({ findDevice });
    expect(await r.resolve('phone-x')).to.deep.equal({ known: true, teamId: null });
  });

  it('an unknown udid resolves to unknown (hidden from non-admins)', async () => {
    const { findDevice } = countingLookup({});
    const r = new DeviceTeamResolver({ findDevice });
    expect(await r.resolve('ghost')).to.deep.equal({ known: false });
  });

  it('an empty or missing udid is unknown without asking the store', async () => {
    const { calls, findDevice } = countingLookup({});
    const r = new DeviceTeamResolver({ findDevice });
    expect(await r.resolve('')).to.deep.equal({ known: false });
    expect(await r.resolve(undefined)).to.deep.equal({ known: false });
    expect(await r.resolve(null)).to.deep.equal({ known: false });
    expect(calls).to.deep.equal([]);
  });

  it('asks the store once per udid within the TTL, however many events there are', async () => {
    const c = clock();
    const { calls, findDevice } = countingLookup({ 'phone-a': { teamId: 'team-a' } });
    const r = new DeviceTeamResolver({ findDevice, now: c.now });
    for (let i = 0; i < 50; i++) {
      await r.resolve('phone-a');
      c.t += 50; // 50 commands, 2.5 s in all
    }
    expect(calls).to.deep.equal(['phone-a']);
  });

  it('concurrent lookups of one udid share a single store call', async () => {
    const { calls, findDevice } = countingLookup({ 'phone-a': { teamId: 'team-a' } });
    const r = new DeviceTeamResolver({ findDevice });
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
    const { calls, findDevice } = countingLookup(rows);
    const r = new DeviceTeamResolver({ findDevice, now: c.now });
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
    const { calls, findDevice } = countingLookup({});
    const r = new DeviceTeamResolver({ findDevice, now: c.now });
    for (let i = 0; i < 10; i++) await r.resolve('ghost');
    expect(calls).to.have.length(1);
  });

  it('a device event refreshes it: note() replaces the cached team without a lookup', async () => {
    const { calls, findDevice } = countingLookup({ 'phone-a': { teamId: 'team-a' } });
    const r = new DeviceTeamResolver({ findDevice });
    await r.resolve('phone-a');
    r.note('phone-a', 'team-b');
    expect(await r.resolve('phone-a')).to.deep.equal({ known: true, teamId: 'team-b' });
    expect(calls).to.have.length(1);
  });

  it('note() turns a remembered unknown into a known device (device_added)', async () => {
    const { calls, findDevice } = countingLookup({});
    const r = new DeviceTeamResolver({ findDevice });
    expect(await r.resolve('new-phone')).to.deep.equal({ known: false });
    r.note('new-phone', null);
    expect(await r.resolve('new-phone')).to.deep.equal({ known: true, teamId: null });
    expect(calls).to.have.length(1);
  });

  it('a lookup that lands after note() does not overwrite the fresher answer', async () => {
    let release!: (row: any) => void;
    const findDevice = () => new Promise<any>((res) => (release = res));
    const r = new DeviceTeamResolver({ findDevice });
    const first = r.resolve('phone-a');
    r.note('phone-a', 'team-b');
    release({ teamId: 'team-a' });
    expect(await first).to.deep.equal({ known: true, teamId: 'team-a' });
    expect(await r.resolve('phone-a')).to.deep.equal({ known: true, teamId: 'team-b' });
  });

  it('a failed lookup hides the device (fail closed) and is not remembered', async () => {
    let fail = true;
    const { calls, findDevice } = countingLookup({
      'phone-a': () => {
        if (fail) throw new Error('db down');
        return { teamId: 'team-a' };
      },
    });
    const r = new DeviceTeamResolver({ findDevice });
    expect(await r.resolve('phone-a')).to.deep.equal({ known: false });
    fail = false;
    expect(await r.resolve('phone-a')).to.deep.equal({ known: true, teamId: 'team-a' });
    expect(calls).to.have.length(2);
  });

  it('builds through Container.get (TypeDI must not try to inject the deps object)', () => {
    expect(() => Container.get(DeviceTeamResolver)).not.to.throw();
  });
});
