import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { prisma } from '../../src/prisma';
import { enrichDevicesWithTeamNames } from '../../src/data-service/device-service';

describe('enrichDevicesWithTeamNames', () => {
  afterEach(() => sinon.restore());

  it('returns teamName null for shared-pool devices without querying teams', async () => {
    const findMany = sinon.stub(prisma.team, 'findMany');
    const rows = await enrichDevicesWithTeamNames([
      { udid: 'a', teamId: null },
      { udid: 'b' },
    ]);
    expect(findMany.called).to.equal(false);
    expect(rows).to.deep.equal([
      { udid: 'a', teamId: null, teamName: null },
      { udid: 'b', teamName: null },
    ]);
  });

  it('batch-resolves team names for assigned devices', async () => {
    sinon.stub(prisma.team, 'findMany').resolves([
      { id: 't1', name: 'Android QA' },
      { id: 't2', name: 'iOS Farm' },
    ] as any);

    const rows = await enrichDevicesWithTeamNames([
      { udid: 'shared', teamId: null },
      { udid: 'a', teamId: 't1' },
      { udid: 'b', teamId: 't2' },
      { udid: 'missing', teamId: 'gone' },
    ]);

    expect(rows).to.deep.equal([
      { udid: 'shared', teamId: null, teamName: null },
      { udid: 'a', teamId: 't1', teamName: 'Android QA' },
      { udid: 'b', teamId: 't2', teamName: 'iOS Farm' },
      { udid: 'missing', teamId: 'gone', teamName: null },
    ]);
  });
});
