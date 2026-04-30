import { Router } from 'express';
import { Container } from 'typedi';
import { TeamService } from '../../services/TeamService';
import { scopeGuard } from '../../middleware/scopeGuard';
import { roleGuard } from '../../middleware/roleGuard';

export function teamsRouter(): Router {
  const r = Router();
  r.use(roleGuard('ADMIN'));
  const svc = Container.get(TeamService);

  r.get('/', scopeGuard(['admin']), async (_req, res) => {
    res.json(await svc.list());
  });

  r.post('/', scopeGuard(['admin']), async (req, res) => {
    const { name } = req.body as { name: string };
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
      const team = await svc.create(name);
      res.json(team);
    } catch (e: any) {
      if (e.code === 'P2002') return res.status(409).json({ error: 'team name already exists' });
      res.status(400).json({ error: e.message });
    }
  });

  r.delete('/:id', scopeGuard(['admin']), async (req, res) => {
    try {
      await svc.delete(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  r.get('/:id/members', scopeGuard(['admin']), async (req, res) => {
    res.json(await svc.listMembers(req.params.id));
  });

  r.post('/:id/members', scopeGuard(['admin']), async (req, res) => {
    const { userId } = req.body as { userId: string };
    if (!userId) return res.status(400).json({ error: 'userId required' });
    try {
      await svc.addMember(req.params.id, userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  r.delete('/:id/members/:userId', scopeGuard(['admin']), async (req, res) => {
    try {
      await svc.removeMember(req.params.id, req.params.userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  return r;
}
