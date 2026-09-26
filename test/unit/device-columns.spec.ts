import { expect } from 'chai';
import { pickDeviceColumns } from '../../src/data-service/deviceColumns';

describe('pickDeviceColumns', () => {
  it('keeps Device columns, including the identity ones', () => {
    const out = pickDeviceColumns({
      udid: 'U1',
      host: 'h',
      marketingName: 'Galaxy S9+',
      formFactor: 'phone',
    });
    expect(out).to.deep.equal({
      udid: 'U1',
      host: 'h',
      marketingName: 'Galaxy S9+',
      formFactor: 'phone',
    });
  });

  // The hub upserts a node's devices as sent. A field the hub's schema lacks
  // made Prisma reject the whole registration (newer node, older hub).
  it('drops keys that are not Device columns, and reports each', () => {
    const dropped: string[] = [];
    const out = pickDeviceColumns({ udid: 'U1', teamName: 'QA', somethingNew: 1 }, (k) =>
      dropped.push(k),
    );
    expect(out).to.deep.equal({ udid: 'U1' });
    expect(dropped).to.deep.equal(['teamName', 'somethingNew']);
  });
});
