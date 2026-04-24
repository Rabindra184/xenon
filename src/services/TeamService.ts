import { Service } from 'typedi';
import { prisma } from '../prisma';
import log from '../logger';

export type TeamRole = 'admin' | 'member';

@Service()
export class TeamService {
  private log = log.scope('Team');

  async list() {
    const rows = await prisma.team.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { devices: true, apiKeys: true } },
      },
    });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt,
      deviceCount: t._count.devices,
      memberCount: t._count.apiKeys,
    }));
  }

  async create(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('name required');
    return prisma.team.create({ data: { name: trimmed } });
  }

  async delete(id: string): Promise<void> {
    const [devices, apiKeys] = await Promise.all([
      prisma.device.count({ where: { teamId: id } }),
      prisma.apiKey.count({ where: { teamId: id, revokedAt: null } }),
    ]);
    if (devices > 0 || apiKeys > 0) {
      throw new Error(
        `Team still has ${devices} device(s) and ${apiKeys} active member(s). Reassign them before deleting.`,
      );
    }
    // Clear the teamId on revoked keys so the FK doesn't block the delete.
    await prisma.apiKey.updateMany({ where: { teamId: id }, data: { teamId: null } });
    await prisma.team.delete({ where: { id } });
  }

  async listMembers(teamId: string) {
    return prisma.apiKey.findMany({
      where: { teamId, revokedAt: null },
      select: { id: true, name: true, role: true, scopes: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addMember(teamId: string, apiKeyId: string, role: TeamRole) {
    if (role !== 'admin' && role !== 'member') throw new Error('invalid role');
    await prisma.apiKey.update({
      where: { id: apiKeyId },
      data: { teamId, role },
    });
  }

  async removeMember(teamId: string, apiKeyId: string) {
    // Clear the team link rather than delete the key — scopes still apply.
    await prisma.apiKey.updateMany({
      where: { id: apiKeyId, teamId },
      data: { teamId: null, role: 'member' },
    });
  }
}
