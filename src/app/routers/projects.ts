import { Router } from 'express';
import { prisma } from '../../prisma';
import { scopeGuard } from '../../middleware/scopeGuard';

export async function listProjects(client: typeof prisma, teamIds: string[] | undefined) {
  const where = teamIds ? { where: { OR: [{ teamId: { in: teamIds } }, { teamId: null }] } } : {};
  return client.project.findMany(where as any);
}

export async function createProject(client: typeof prisma, body: { name?: string; teamId?: string }) {
  if (!body.name || !body.name.trim()) throw new Error('name is required');
  return client.project.create({ data: { name: body.name.trim(), teamId: body.teamId ?? null } });
}

export function projectsRouter(): Router {
  const r = Router();
  r.get('/', async (req, res) => {
    res.json(await listProjects(prisma, req.auth?.teamIds));
  });
  r.post('/', scopeGuard(['admin']), async (req, res) => {
    try { res.status(201).json(await createProject(prisma, req.body ?? {})); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  return r;
}
