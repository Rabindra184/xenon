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
    const [devices, members] = await Promise.all([
      prisma.device.count({ where: { teamId: id } }),
      prisma.teamMember.count({ where: { teamId: id } }),
    ]);
    if (devices > 0 || members > 0) {
      throw new Error(
        `Team still has ${devices} device(s) and ${members} member(s). Reassign them before deleting.`,
      );
    }
    // Clear teamId on any (revoked) ApiKey rows so the FK doesn't block delete.
    await prisma.apiKey.updateMany({ where: { teamId: id }, data: { teamId: null } });
    await prisma.team.delete({ where: { id } });
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
