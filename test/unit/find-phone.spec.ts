import { expect } from 'chai';
import {
  ambiguousPhoneBody,
  ControlDevice,
  findPhone,
  HIDDEN_DEVICE_UDID,
  readHostParam,
} from '../../src/middleware/controlDevice';

/**
 * findPhone: a phone by udid and, when given, host.
 *
 * A Device row is keyed by udid and host, and an emulator's udid repeats
 * across servers (emulator-5554 on a hub and on its node). With a host the
 * answer is that row or none; without one, the one row of that udid the
 * caller can see, none, or ambiguous when two or more are visible. A row the
 * caller can't see is never returned and never named.
 */

const UDID = 'emulator-5554';
const HUB = 'http://10.0.0.1:4723';
const NODE = 'http://10.0.0.2:4723';
const TEAM_A = 'team-a';
const TEAM_B = 'team-b';

/** A fake store lookup over `table`, counting its calls. */
function rowsOf(table: ControlDevice[]) {
  const calls: string[] = [];
  const rows = async (udid: string) => {
    calls.push(udid);
    return table.filter((r) => r.udid === udid);
  };
  return { rows, calls };
}

describe('findPhone (phone identity by udid and host)', () => {
  const hubRow: ControlDevice = { udid: UDID, host: HUB, teamId: null };
  const nodeRow: ControlDevice = { udid: UDID, host: NODE, teamId: TEAM_B };

  describe('with a host', () => {
    it('finds the row with that udid and host', async () => {
      const { rows } = rowsOf([hubRow, nodeRow]);
      const found = await findPhone(UDID, { host: NODE }, rows);
      expect(found).to.deep.equal({ kind: 'found', device: nodeRow });
    });

    it('is none when no row of the udid has that host', async () => {
      const { rows } = rowsOf([hubRow]);
      expect(await findPhone(UDID, { host: NODE }, rows)).to.deep.equal({ kind: 'none' });
    });

    it('is none when the host names a row the caller cannot see', async () => {
      const { rows } = rowsOf([hubRow, nodeRow]);
      expect(await findPhone(UDID, { host: NODE, teamIds: [TEAM_A] }, rows)).to.deep.equal({
        kind: 'none',
      });
    });

    it('matches the host exactly, as the device list reports it', async () => {
      const { rows } = rowsOf([{ udid: UDID, host: 'http://a:1', teamId: null }]);
      expect(await findPhone(UDID, { host: 'http://a:1/' }, rows)).to.deep.equal({ kind: 'none' });
      expect(await findPhone(UDID, { host: 'HTTP://A:1' }, rows)).to.deep.equal({ kind: 'none' });
      expect((await findPhone(UDID, { host: 'http://a:1' }, rows)).kind).to.equal('found');
    });
  });

  describe('without a host', () => {
    it('finds the only row of the udid', async () => {
      const { rows } = rowsOf([hubRow]);
      expect(await findPhone(UDID, {}, rows)).to.deep.equal({ kind: 'found', device: hubRow });
    });

    it('is none when no row has the udid', async () => {
      const { rows } = rowsOf([]);
      expect(await findPhone(UDID, {}, rows)).to.deep.equal({ kind: 'none' });
    });

    it('is ambiguous when two visible rows share the udid, naming their hosts in row order', async () => {
      const { rows } = rowsOf([nodeRow, hubRow]);
      expect(await findPhone(UDID, {}, rows)).to.deep.equal({
        kind: 'ambiguous',
        hosts: [NODE, HUB],
      });
    });

    it('finds the visible row when the other is hidden, and never names the hidden one', async () => {
      const { rows } = rowsOf([nodeRow, hubRow]);
      expect(await findPhone(UDID, { teamIds: [TEAM_A] }, rows)).to.deep.equal({
        kind: 'found',
        device: hubRow,
      });
    });

    it('is none when the only row is hidden', async () => {
      const { rows } = rowsOf([nodeRow]);
      expect(await findPhone(UDID, { teamIds: [] }, rows)).to.deep.equal({ kind: 'none' });
    });

    it('sees every row when teamIds is undefined (an admin, or auth disabled)', async () => {
      const { rows } = rowsOf([
        { udid: UDID, host: HUB, teamId: TEAM_A },
        { udid: UDID, host: NODE, teamId: TEAM_B },
      ]);
      expect(await findPhone(UDID, { teamIds: undefined }, rows)).to.deep.equal({
        kind: 'ambiguous',
        hosts: [HUB, NODE],
      });
    });

    it('is ambiguous among the visible rows only', async () => {
      const third = 'http://10.0.0.3:4723';
      const { rows } = rowsOf([
        { udid: UDID, host: HUB, teamId: null },
        { udid: UDID, host: NODE, teamId: TEAM_B },
        { udid: UDID, host: third, teamId: TEAM_A },
      ]);
      expect(await findPhone(UDID, { teamIds: [TEAM_A] }, rows)).to.deep.equal({
        kind: 'ambiguous',
        hosts: [HUB, third],
      });
    });
  });

  it('never finds the hidden-device placeholder, and looks nothing up for it', async () => {
    const { rows, calls } = rowsOf([{ udid: HIDDEN_DEVICE_UDID, host: HUB, teamId: null }]);
    expect(await findPhone(HIDDEN_DEVICE_UDID, {}, rows)).to.deep.equal({ kind: 'none' });
    expect(await findPhone(HIDDEN_DEVICE_UDID, { host: HUB }, rows)).to.deep.equal({
      kind: 'none',
    });
    expect(calls).to.deep.equal([]);
  });

  it('lets a failing lookup reject, for the caller to answer', async () => {
    const rows = async () => {
      throw new Error('store down');
    };
    let caught: unknown;
    try {
      await findPhone(UDID, {}, rows);
    } catch (e) {
      caught = e;
    }
    expect((caught as Error)?.message).to.equal('store down');
  });
});

describe('ambiguousPhoneBody', () => {
  it('is the 409 body that names the visible hosts', () => {
    expect(ambiguousPhoneBody('emulator-5554', ['h1', 'h2'])).to.deep.equal({
      error: 'ambiguous_phone',
      message: 'Two servers have a phone named emulator-5554. Name the one you mean with its host.',
      hosts: ['h1', 'h2'],
    });
  });
});

describe('readHostParam', () => {
  it('is undefined when the host is absent', () => {
    expect(readHostParam(undefined)).to.equal(undefined);
  });

  it('is null for anything but a non-empty string', () => {
    expect(readHostParam('')).to.equal(null);
    expect(readHostParam([])).to.equal(null);
    expect(readHostParam(['a', 'b'])).to.equal(null);
    expect(readHostParam(5)).to.equal(null);
    expect(readHostParam({ a: 'b' })).to.equal(null);
    expect(readHostParam(null)).to.equal(null);
  });

  it('is the host when it is a non-empty string', () => {
    expect(readHostParam('h')).to.equal('h');
    expect(readHostParam('http://10.0.0.2:4723')).to.equal('http://10.0.0.2:4723');
  });
});
