import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import { UserService } from '../../src/services/UserService';
import { TeamService } from '../../src/services/TeamService';
import { prisma } from '../../src/prisma';

describe('team-membership migration backfill (integration)', function () {
  this.timeout(60_000);

  it('no TeamMember row points at Legacy Admin', async () => {
    const legacy = await prisma.user.findFirst({
      where: { email: 'legacy-admin@xenon.local' },
    });
    if (!legacy) {
      // Legacy Admin only exists if Phase 1's adoption migration actually ran
      // against a non-empty ApiKey table. Skip if absent.
      // eslint-disable-next-line no-console
      console.log('skipped: no Legacy Admin in this DB');
      return;
    }
    const polluted = await prisma.teamMember.count({ where: { userId: legacy.id } });
    expect(polluted).to.equal(0);
  });

  it('addMember / removeMember round-trip an arbitrary user', async () => {
    const u = await Container.get(UserService).createUser({
      email: `tm-rt-${Date.now()}@xenon.local`,
      name: 'TM Round Trip',
      password: 'tm-rt-pass-1',
      role: 'MEMBER',
    });
    const t = await Container.get(TeamService).create(`tm-rt-${Date.now()}`);
    try {
      await Container.get(TeamService).addMember(t.id, u.id);
      const members = await Container.get(TeamService).listMembers(t.id);
      expect(members.find((m) => m.userId === u.id)).to.exist;
      await Container.get(TeamService).removeMember(t.id, u.id);
      const after = await Container.get(TeamService).listMembers(t.id);
      expect(after.find((m) => m.userId === u.id)).to.not.exist;
    } finally {
      await prisma.teamMember.deleteMany({ where: { userId: u.id } });
      await prisma.team.delete({ where: { id: t.id } }).catch(() => undefined);
      await prisma.userSession.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    }
  });
});
