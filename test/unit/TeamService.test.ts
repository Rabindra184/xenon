import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { TeamService } from '../../src/services/TeamService';
import { prisma } from '../../src/prisma';

describe('TeamService (User-keyed)', () => {
  afterEach(() => sinon.restore());

  it('list() returns deviceCount + memberCount via TeamMember', async () => {
    sinon.stub(prisma.team, 'findMany').resolves([
      {
        id: 't1',
        name: 'Alpha',
        createdAt: new Date(),
        _count: { devices: 2, members: 3 },
      },
    ] as any);
    const out = await new TeamService().list();
    expect(out[0]).to.include({ id: 't1', deviceCount: 2, memberCount: 3 });
  });

  it('listMembers() returns User-shaped rows via TeamMember join', async () => {
    sinon.stub(prisma.teamMember, 'findMany').resolves([
      {
        userId: 'u1',
        createdAt: new Date('2026-01-01'),
        user: { email: 'a@x.local', name: 'Alice', role: 'ADMIN' },
      },
    ] as any);
    const out = await new TeamService().listMembers('t1');
    expect(out[0]).to.include({ userId: 'u1', email: 'a@x.local', name: 'Alice', role: 'ADMIN' });
  });

  it('addMember() creates a TeamMember row', async () => {
    const create = sinon.stub(prisma.teamMember, 'create').resolves({} as any);
    await new TeamService().addMember('t1', 'u1');
    expect(create.firstCall.args[0].data).to.deep.equal({ teamId: 't1', userId: 'u1' });
  });

  it('removeMember() deletes by composite key', async () => {
    const del = sinon.stub(prisma.teamMember, 'delete').resolves({} as any);
    await new TeamService().removeMember('t1', 'u1');
    expect(del.firstCall.args[0].where).to.deep.equal({
      teamId_userId: { teamId: 't1', userId: 'u1' },
    });
  });

  it('delete() blocks when team has devices OR active members', async () => {
    sinon.stub(prisma.device, 'count').resolves(1);
    sinon.stub(prisma.teamMember, 'count').resolves(0);
    sinon.stub(prisma.app, 'count').resolves(0);
    let err: Error | undefined;
    try {
      await new TeamService().delete('t1');
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).to.match(/Reassign them before deleting/);
  });

  // A deleted team's apps would fall back to the shared pool (App.teamId is
  // onDelete: SetNull), which would publish them to every member. Refused,
  // as for its phones: the admin moves them first.
  it('delete() blocks while the team still owns apps', async () => {
    sinon.stub(prisma.device, 'count').resolves(0);
    sinon.stub(prisma.teamMember, 'count').resolves(0);
    const apps = sinon.stub(prisma.app, 'count').resolves(2);
    const teamDel = sinon.stub(prisma.team, 'delete').resolves({} as any);
    let err: Error | undefined;
    try {
      await new TeamService().delete('t1');
    } catch (e) {
      err = e as Error;
    }
    expect(apps.firstCall.args[0]).to.deep.equal({ where: { teamId: 't1' } });
    expect(err?.message).to.match(/2 app\(s\)/);
    expect(err?.message).to.match(/Reassign them before deleting/);
    expect(teamDel.called).to.equal(false);
  });

  it('delete() drops FK on revoked apiKeys then deletes the team', async () => {
    sinon.stub(prisma.device, 'count').resolves(0);
    sinon.stub(prisma.teamMember, 'count').resolves(0);
    sinon.stub(prisma.app, 'count').resolves(0);
    const apiKeyUpdate = sinon.stub(prisma.apiKey, 'updateMany').resolves({ count: 0 } as any);
    const teamDel = sinon.stub(prisma.team, 'delete').resolves({} as any);
    await new TeamService().delete('t1');
    expect(apiKeyUpdate.calledOnce).to.be.true;
    expect(teamDel.calledOnce).to.be.true;
  });
});
