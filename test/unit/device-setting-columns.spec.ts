import { expect } from 'chai';
import { Prisma } from '../../src/generated/client';
import {
  DISCOVERY_FIELDS,
  NODE_REPORT_FIELDS,
  pickSettingFields,
  SETTING_FIELDS,
} from '../../src/data-service/deviceFieldOwners';
import { restoredColumns } from '../../src/data-service/deviceSettings';

/**
 * The settings a phone keeps when its Device row goes (deviceSettings.ts) are
 * the Device columns placed as `setting` in deviceFieldOwners.ts, and the
 * DeviceSetting table has exactly those, besides its key. A setting added to
 * one and not the other would be lost, or never written.
 */
describe('Saved phone settings: the columns', () => {
  it('DeviceSetting has exactly the setting columns, besides its key', () => {
    const saved = Object.keys(Prisma.DeviceSettingScalarFieldEnum).filter(
      (column) => !['udid', 'host', 'updatedAt'].includes(column),
    );
    expect([...SETTING_FIELDS].sort()).to.deep.equal(saved.sort());
  });

  it('are team, tags, maintenance and the reservation', () => {
    expect([...SETTING_FIELDS].sort()).to.deep.equal(
      [
        'reservationReason',
        'reservedBy',
        'reservedByUserId',
        'reservedUntil',
        'tags',
        'teamId',
        'userBlocked',
      ].sort(),
    );
  });

  it('are never written by a sync or by a node’s report', () => {
    for (const column of SETTING_FIELDS) {
      expect(DISCOVERY_FIELDS.has(column), column).to.equal(false);
      expect(NODE_REPORT_FIELDS.has(column), column).to.equal(false);
    }
  });

  it('pickSettingFields keeps only them', () => {
    expect(
      pickSettingFields({ teamId: 't', busy: true, session_id: 's', userBlocked: true }),
    ).to.deep.equal({ teamId: 't', userBlocked: true });
  });

  it('a new row starts with every one of them, so a cleared one stays cleared', () => {
    const now = 1_000;
    expect(Object.keys(restoredColumns({}, now)).sort()).to.deep.equal([...SETTING_FIELDS].sort());
    expect(restoredColumns({}, now)).to.deep.equal({
      teamId: null,
      tags: null,
      userBlocked: false,
      reservationReason: null,
      reservedBy: null,
      reservedByUserId: null,
      reservedUntil: null,
    });
  });

  it('a reservation only while it holds', () => {
    const reservation = {
      reservedBy: 'Dana',
      reservedByUserId: 'u1',
      reservationReason: 'release',
      reservedUntil: 2_000,
    };
    expect(restoredColumns(reservation, 1_999)).to.include(reservation);
    expect(restoredColumns(reservation, 2_000)).to.include({
      reservedBy: null,
      reservedByUserId: null,
      reservationReason: null,
      reservedUntil: null,
    });
  });
});
