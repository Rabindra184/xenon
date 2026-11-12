/**
 * Which scope a recording write takes (ENH-06, decided 2026-11-12).
 *
 * A recording of phones, and every write on its group, take `devices`, as
 * always: it holds the phones. A recording of the caller's own sessions
 * (`POST /recordings` with `sessionIds`) holds nothing and controls nothing,
 * so it takes `sessions` too, which a member's own tokens carry; so does
 * every write on such a group (stop, marks, clearing marks, delete), so
 * whoever started it can finish it. Reads pass, as with mutationScopeGuard.
 *
 * Which groups are observer groups is the orchestrator's memory: after a
 * restart their writes take `devices` again. A lookup that throws counts as
 * a recording of phones.
 */
import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { callerHasScope } from '../../middleware/scopeGuard';
import { RecordingOrchestrator } from '../../services/recording/RecordingOrchestrator';

const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/** Mounted at `/recordings`, before the routes, after the API's JSON parser. */
export function recordingsScopeGuard(req: Request, res: Response, next: NextFunction) {
  if (!STATE_CHANGING.has(req.method)) return next();
  const auth = req.auth;
  if (!auth) return res.status(401).json({ error: 'unauthenticated' });
  // `devices` does everything here; the group is looked up only without it.
  if (callerHasScope(auth, ['devices'])) return next();
  if (callerHasScope(auth, ['sessions']) && isObserverWrite(req)) return next();
  return res.status(403).json({ error: 'insufficient scope' });
}

function isObserverWrite(req: Request): boolean {
  // req.path is relative to the mount: '/' for /recordings itself, else
  // '/<groupId>/...'.
  const [first] = req.path.split('/').filter(Boolean);
  if (first === undefined) return req.method === 'POST' && req.body?.sessionIds !== undefined;
  try {
    return Container.get(RecordingOrchestrator).isObserverGroup(decodeURIComponent(first)) === true;
  } catch {
    return false;
  }
}
