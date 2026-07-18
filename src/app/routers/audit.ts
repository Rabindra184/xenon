import { Router, Request, Response } from 'express';
import { Container } from 'typedi';
import { roleGuard } from '../../middleware/roleGuard';
import { mutationScopeGuard } from '../../middleware/scopeGuard';
import { EventLogService } from '../../services/EventLogService';

// The 2b gateway ships batched MCP tool-call audit records here. It
// authenticates as a service identity (an API key scoped `admin`), not a
// human MEMBER — but the repo's guard primitives compose on role+scope, so
// we reuse them: roleGuard('MEMBER') is the floor every authenticated
// caller clears, and mutationScopeGuard(['admin']) is the actual gate,
// requiring the caller's key to carry the `admin` flat scope. This avoids
// inventing a parallel guard mechanism for one route while still keeping
// audit writes restricted to a privileged, deliberately-provisioned key
// (documented here per the task brief instead of a bespoke scope).
const MAX_BATCH_SIZE = 1000;

export interface AuditEventInput {
  subject: string;
  tool: string;
  decision: string;
  latencyMs: number;
  correlationId?: string;
  sessionId?: string;
}

function validateEvent(event: unknown): string | null {
  if (!event || typeof event !== 'object') return 'event must be an object';
  const e = event as Record<string, unknown>;
  if (typeof e.subject !== 'string' || !e.subject) return 'subject is required';
  if (typeof e.tool !== 'string' || !e.tool) return 'tool is required';
  if (typeof e.decision !== 'string' || !e.decision) return 'decision is required';
  if (typeof e.latencyMs !== 'number' || !Number.isFinite(e.latencyMs)) return 'latencyMs is required (number)';
  if (e.correlationId !== undefined && typeof e.correlationId !== 'string') {
    return 'correlationId must be a string';
  }
  if (e.sessionId !== undefined && typeof e.sessionId !== 'string') {
    return 'sessionId must be a string';
  }
  return null;
}

interface MakeRouterOpts {
  eventLogService?: Pick<EventLogService, 'appendSafe'>;
}

export function makeRouter(opts: MakeRouterOpts = {}): Router {
  const router = Router();
  const svc = opts.eventLogService ?? Container.get(EventLogService);

  router.post('/events', (req: Request, res: Response) => {
    const { events } = req.body ?? {};

    if (!Array.isArray(events)) {
      return res.status(400).json({ error: 'bad_request', details: 'events must be an array' });
    }
    if (events.length > MAX_BATCH_SIZE) {
      return res.status(400).json({
        error: 'bad_request',
        details: `events batch too large (max ${MAX_BATCH_SIZE})`,
      });
    }
    for (let i = 0; i < events.length; i++) {
      const err = validateEvent(events[i]);
      if (err) {
        return res.status(400).json({ error: 'bad_request', details: `event[${i}]: ${err}` });
      }
    }

    const auth: any = (req as any).auth;
    const apiKey: any = (req as any).apiKey;
    const teamId = auth?.teamId ?? apiKey?.teamId ?? undefined;

    for (const event of events as AuditEventInput[]) {
      svc.appendSafe({
        type: 'mcp_audit',
        payload: event,
        correlationId: event.correlationId,
        teamId,
      });
    }

    return res.status(202).json({ ingested: events.length });
  });

  return router;
}

export function auditRouter(opts: MakeRouterOpts = {}): Router {
  const router = Router();
  router.use(roleGuard('MEMBER'));
  router.use(mutationScopeGuard(['admin']));
  router.use(makeRouter(opts));
  return router;
}
