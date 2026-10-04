import { Service } from 'typedi';
import { prisma } from '../prisma';
import log from '../logger';

@Service()
export class TeamService {
  private log = log.scope('Team');

  async list() {
    const rows = await prisma.team.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { devices: true, members: true } } },
    });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt,
      deviceCount: t._count.devices,
      memberCount: t._count.members,
    }));
  }

  async create(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('name required');
    return prisma.team.create({ data: { name: trimmed } });
  }

  async delete(id: string): Promise<void> {
    // Apps too: App.teamId is onDelete SetNull, so deleting a team that owns
    // apps would quietly share them with every member. So is a phone's saved
    // team (DeviceSetting): a phone of the team that is not connected now
    // would come back in the shared pool.
    const [connected, saved, members, apps] = await Promise.all([
      prisma.device.count({ where: { teamId: id } }),
      prisma.deviceSetting.findMany({ where: { teamId: id }, select: { udid: true, host: true } }),
      prisma.teamMember.count({ where: { teamId: id } }),
      prisma.app.count({ where: { teamId: id } }),
    ]);
    const away = await this.notConnected(saved);
    const devices = connected + away;
    if (devices > 0 || members > 0 || apps > 0) {
      const phones =
        away > 0 ? `${devices} device(s) (${away} not connected now)` : `${devices} device(s)`;
      throw new Error(
        `Team still has ${phones}, ${members} member(s) and ${apps} app(s). Reassign them before deleting.`,
      );
    }
    // Clear teamId on any (revoked) ApiKey rows so the FK doesn't block delete.
    await prisma.apiKey.updateMany({ where: { teamId: id }, data: { teamId: null } });
    await prisma.team.delete({ where: { id } });
  }

  /** How many of these saved phones have no Device row: not connected now. */
  private async notConnected(saved: Array<{ udid: string; host: string }>): Promise<number> {
    if (saved.length === 0) return 0;
    const here = await prisma.device.count({
      where: { OR: saved.map(({ udid, host }) => ({ udid, host })) },
    });
    return saved.length - here;
  }

  async listMembers(teamId: string) {
    const rows = await prisma.teamMember.findMany({
      where: { teamId },
      include: { user: { select: { email: true, name: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.user.role,
      addedAt: m.createdAt,
    }));
  }

  async addMember(teamId: string, userId: string) {
    return prisma.teamMember.create({ data: { teamId, userId } });
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId, userId } },
    });
  }
}
