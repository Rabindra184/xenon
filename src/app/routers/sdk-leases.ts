import { Router, Request, Response } from 'express';
import { Container } from 'typedi';
import { roleGuard } from '../../middleware/roleGuard';
import { mutationScopeGuard } from '../../middleware/scopeGuard';
import { leaseTokenMiddleware } from '../../middleware/leaseTokenMiddleware';
import {
  LeaseService,
  NoMatchingDevice,
  AllMatchingBusy,
  DeviceUnhealthy,
  LeaseTokenMismatch,
  LeaseGone,
  LeaseWaiting,
  GET_WAIT_MAX_MS,
  MAX_MEMBERS,
  MAX_WAIT_MS,
} from '../../services/lease/LeaseService';
import type { LeaseFilters } from '../../services/lease/leaseFilters';
import log from '../../logger';

type LeaseShape =
  | { filters: LeaseFilters; waitMs: number }
  | { members: Array<{ filters: LeaseFilters }>; waitMs: number }
  | { error: string };

const hasPlatform = (filters: unknown): filters is LeaseFilters =>
  !!filters && typeof filters === 'object' && typeof (filters as any).platform === 'string';

/**
 * A create's phones and wait: `filters` (one phone) or `members` (1 to
 * MAX_MEMBERS, each with `filters.platform`), never both, and `waitMs` an
 * integer from 0 (the default) to MAX_WAIT_MS.
 */
function readLeaseShape(body: Record<string, unknown>): LeaseShape {
  const { filters, members, waitMs = 0 } = body as any;
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > MAX_WAIT_MS) {
    return { error: `waitMs must be an integer from 0 to ${MAX_WAIT_MS}` };
  }
  if (members !== undefined) {
    if (filters !== undefined) return { error: 'send filters or members, not both' };
    if (!Array.isArray(members) || members.length < 1 || members.length > MAX_MEMBERS) {
      return { error: `members must list 1 to ${MAX_MEMBERS} members` };
    }
    const at = members.findIndex(
      (m: any) => !m || typeof m !== 'object' || !hasPlatform(m.filters),
    );
    if (at !== -1) return { error: `members[${at}].filters.platform required` };
    return { members: members.map((m: any) => ({ filters: m.filters })), waitMs };
  }
  if (!hasPlatform(filters)) return { error: 'filters.platform required' };
  return { filters, waitMs };
}

/**
 * A GET's `waitMs` query value: an integer from 0 (the default) to
 * GET_WAIT_MAX_MS, or null when it is anything else.
 */
function readGetWait(raw: unknown): number | null {
  if (raw === undefined) return 0;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const waitMs = Number(raw);
  return waitMs <= GET_WAIT_MAX_MS ? waitMs : null;
}

/** The 410 body: today's, plus `reason` when a group ended for one. */
function goneBody(err: LeaseGone, base: Record<string, unknown>): Record<string, unknown> {
  return err.reason === undefined ? base : { ...base, reason: err.reason };
}

interface MakeRouterOpts {
  leaseService?: any;
}

export function makeRouter(opts: MakeRouterOpts = {}): Router {
  const router = Router();
  const svc = opts.leaseService ?? Container.get(LeaseService);
  const logger = log.scope('sdk-leases-router');

  router.post('/', async (req: Request, res: Response) => {
    const { durationMs, heartbeatSeconds, reason, buildId } = req.body ?? {};
    const shape = readLeaseShape(req.body ?? {});
    if ('error' in shape) {
      return res.status(400).json({ error: 'bad_request', details: shape.error });
    }
    const apiKey: any = (req as any).apiKey;
    // IMPORTANT 4 (Phase 2a review): the bearer-auth path sets req.auth (with
    // userId/teamId) but never req.apiKey. Without the req.auth fallback a
    // bearer-authed lease create (e.g. xenon_acquire_device) was recorded as
    // actorId:'anonymous', teamId:null — losing attribution.
    const auth: any = (req as any).auth;
    try {
      const out = await svc.create({
        ...shape,
        durationMs: typeof durationMs === 'number' ? durationMs : 30 * 60 * 1000,
        heartbeatSeconds: typeof heartbeatSeconds === 'number' ? heartbeatSeconds : 30,
        actorId: apiKey?.id ?? auth?.userId ?? 'anonymous',
        teamId: apiKey?.teamId ?? auth?.teamId ?? null,
        // Teams are a device boundary: a member's lease lands only on a phone
        // they can see. undefined (admin, auth disabled) is unscoped.
        callerTeamIds: auth?.teamIds,
        buildId,
        reason,
      });
      return res.status(out.status === 'waiting' ? 202 : 201).json(out.body);
    } catch (err) {
      if (err instanceof NoMatchingDevice) {
        return res.status(404).json({ error: 'no_matching_device', message: err.message });
      }
      if (err instanceof AllMatchingBusy) {
        return res.status(409).json({ error: 'all_matching_busy', retryAfterMs: 2_000 });
      }
      if (err instanceof DeviceUnhealthy) {
        return res.status(503).json({ error: 'device_unhealthy', details: err.message });
      }
      logger.error(`create failed: ${(err as Error).message}`);
      return res.status(500).json({ error: 'internal', message: (err as Error).message });
    }
  });

  router.get('/:id', leaseTokenMiddleware, async (req: Request, res: Response) => {
    const waitMs = readGetWait(req.query.waitMs);
    if (waitMs === null) {
      return res.status(400).json({
        error: 'bad_request',
        details: `waitMs must be an integer from 0 to ${GET_WAIT_MAX_MS}`,
      });
    }
    // A client that leaves ends the wait, and with it the lease's listener.
    const left = new AbortController();
    res.on('close', () => left.abort());
    try {
      const out = await svc.get(req.params.id, (req as any).leaseToken, waitMs, left.signal);
      if (left.signal.aborted) return undefined;
      return res.status(out.status === 'waiting' ? 202 : 200).json(out.body);
    } catch (err) {
      if (left.signal.aborted) return undefined;
      if (err instanceof LeaseTokenMismatch) return res.status(403).json({ error: 'token_mismatch' });
      if (err instanceof LeaseGone) {
        return res.status(410).json(goneBody(err, { error: 'gone', message: err.message }));
      }
      return res.status(500).json({ error: 'internal', message: (err as Error).message });
    }
  });

  router.post('/:id/heartbeat', leaseTokenMiddleware, async (req: Request, res: Response) => {
    try {
      const out = await svc.heartbeat(req.params.id, (req as any).leaseToken);
      return res.status(200).json(out);
    } catch (err) {
      if (err instanceof LeaseTokenMismatch) return res.status(403).json({ error: 'token_mismatch' });
      if (err instanceof LeaseGone) {
        return res.status(410).json(goneBody(err, { error: 'gone', message: err.message }));
      }
      return res.status(500).json({ error: 'internal', message: (err as Error).message });
    }
  });

  router.post('/:id/extend', leaseTokenMiddleware, async (req: Request, res: Response) => {
    const { durationMs } = req.body ?? {};
    if (typeof durationMs !== 'number') return res.status(400).json({ error: 'bad_request', details: 'durationMs required' });
    try {
      const out = await svc.extend(req.params.id, (req as any).leaseToken, durationMs);
      return res.status(200).json(out);
    } catch (err) {
      if (err instanceof LeaseTokenMismatch) return res.status(403).json({ error: 'token_mismatch' });
      if (err instanceof LeaseWaiting) {
        return res.status(409).json({ error: 'lease_waiting', message: err.message });
      }
      if (err instanceof LeaseGone) return res.status(410).json(goneBody(err, { error: 'gone' }));
      return res.status(500).json({ error: 'internal', message: (err as Error).message });
    }
  });

  router.delete('/:id', leaseTokenMiddleware, async (req: Request, res: Response) => {
    try {
      await svc.release(req.params.id, (req as any).leaseToken);
      return res.status(204).send();
    } catch (err) {
      if (err instanceof LeaseTokenMismatch) return res.status(403).json({ error: 'token_mismatch' });
      if (err instanceof LeaseGone) return res.status(404).json({ error: 'not_found' });
      return res.status(500).json({ error: 'internal', message: (err as Error).message });
    }
  });

  return router;
}

export default function register(apiRouter: Router): void {
  const router = Router();
  router.use(roleGuard('MEMBER'));
  router.use(mutationScopeGuard(['devices']));
  router.use(makeRouter());
  apiRouter.use('/sdk/leases', router);
}
