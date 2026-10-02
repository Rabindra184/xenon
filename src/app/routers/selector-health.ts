import { Request, Response, Router } from 'express';
import type { Prisma } from '../../generated/client';
import log from '../../logger';
import { SessionCaller, visibleSessionWhere } from '../../services/device-access/sessionVisibility';
import { canActOnSelectors } from '../../services/selector-health/access';
import { listSelectors, parseSelectorListQuery } from '../../services/selector-health/selectorList';

type Caller = SessionCaller & { scopes?: string | string[] };

export const callerOf = (request: Request): Caller | undefined =>
  (request as Request & { auth?: Caller }).auth;

/** The caller's sessions as a Session `where`; undefined for an admin, or with auth disabled. */
export async function scopeOf(request: Request): Promise<Prisma.SessionWhereInput | undefined> {
  return (await visibleSessionWhere(callerOf(request))) as Prisma.SessionWhereInput | undefined;
}

/** One tab of Selector Health's list, the four tab counts, and whether the caller may act. */
export async function getSelectorList(request: Request, response: Response) {
  try {
    const query = parseSelectorListQuery(request.query as Record<string, unknown>);
    const answer = await listSelectors(query, await scopeOf(request));
    return response
      .status(200)
      .json({ ...answer, canAct: canActOnSelectors(callerOf(request)?.scopes) });
  } catch (err) {
    log.error(`[SelectorHealth] list failed: ${(err as Error)?.message ?? err}`);
    return response.status(500).json({ error: 'internal' });
  }
}

function register(router: Router) {
  router.get('/healing/selectors', getSelectorList);
}

export default { register };
