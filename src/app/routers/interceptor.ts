import { Request, Response, Router } from 'express';
import { Container } from 'typedi';
import * as fs from 'fs';
import { InterceptorService } from '../../services/InterceptorService';
import { config } from '../../config';
import { loadArchivedHar, loadArchivedRequests } from '../../services/interceptor/SessionArchive';
import { roleGuard } from '../../middleware/roleGuard';

const router = Router();
router.use(roleGuard('ADMIN'));

// GET routes serve from the live in-memory state when the interceptor is active for
// the session, and fall back to the on-disk archive when it has been stopped (so the
// dashboard can still render the network panel for finished sessions). 404 only when
// neither source has data. Mock-management routes (POST/DELETE) keep the strict
// active-session requirement — there is no meaningful "modify mocks on a finished
// session" semantic.

router.get('/sessions/:sessionId/requests', (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  try {
    const service = Container.get(InterceptorService);
    if (service.isActive(sessionId)) {
      return res.json({ requests: service.getRequests(sessionId) });
    }
    const archived = loadArchivedRequests(config.sessionAssetsPath, sessionId);
    if (archived) return res.json({ requests: archived });
    return res.status(404).json({ error: 'interceptor inactive', sessionId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sessions/:sessionId/requests/:requestId', (req: Request, res: Response) => {
  const { sessionId, requestId } = req.params;
  try {
    const service = Container.get(InterceptorService);
    if (service.isActive(sessionId)) {
      const entry = service.getRequest(sessionId, requestId);
      if (!entry) return res.status(404).json({ error: 'not found' });
      if (entry.bodyPath && entry.resBody == null) {
        try {
          const body = fs.readFileSync(entry.bodyPath, 'utf8');
          return res.json({ ...entry, resBody: body });
        } catch (e: any) {
          return res.json(entry);
        }
      }
      return res.json(entry);
    }
    const archived = loadArchivedRequests(config.sessionAssetsPath, sessionId);
    if (!archived) return res.status(404).json({ error: 'interceptor inactive', sessionId });
    const entry = archived.find((e) => e.id === requestId);
    if (!entry) return res.status(404).json({ error: 'not found' });
    return res.json(entry);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sessions/:sessionId/har', (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  try {
    const service = Container.get(InterceptorService);
    res.set('Content-Type', 'application/json');
    res.set('Content-Disposition', `attachment; filename="${sessionId}.har"`);
    if (service.isActive(sessionId)) {
      return res.send(JSON.stringify(service.exportHar(sessionId), null, 2));
    }
    const har = loadArchivedHar(config.sessionAssetsPath, sessionId);
    if (har) return res.send(har);
    res.removeHeader('Content-Disposition');
    return res.status(404).json({ error: 'interceptor inactive', sessionId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sessions/:sessionId/mocks', (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  try {
    const service = Container.get(InterceptorService);
    if (!service.isActive(sessionId)) {
      return res.status(404).json({ error: 'interceptor inactive', sessionId });
    }
    res.json({ mocks: service.listMocks(sessionId) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sessions/:sessionId/mocks', (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  try {
    const service = Container.get(InterceptorService);
    if (!service.isActive(sessionId)) {
      return res.status(404).json({ error: 'interceptor inactive', sessionId });
    }
    const id = service.addMock(sessionId, req.body);
    res.status(201).json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/sessions/:sessionId/mocks/:mockId', (req: Request, res: Response) => {
  const { sessionId, mockId } = req.params;
  try {
    const service = Container.get(InterceptorService);
    if (!service.isActive(sessionId)) {
      return res.status(404).json({ error: 'interceptor inactive', sessionId });
    }
    const removed = service.removeMock(sessionId, mockId);
    res.json({ removed });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/sessions/:sessionId/mocks', (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  try {
    const service = Container.get(InterceptorService);
    if (!service.isActive(sessionId)) {
      return res.status(404).json({ error: 'interceptor inactive', sessionId });
    }
    service.clearMocks(sessionId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

function register(parentRouter: Router) {
  parentRouter.use('/interceptor', router);
}

export default {
  register,
};
