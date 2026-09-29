import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { deviceTeamGuard } from '../../src/middleware/deviceTeamGuard';
import { deviceAccessGuard } from '../../src/middleware/deviceAccessGuard';

/**
 * The two /control guards share one device lookup per request.
 *
 * Both need the device the request targets: the team guard for its team, the
 * ownership guard for its lock. Each used to parse the udid and query the
 * store on its own, so a member's tap cost two queries before the handler's
 * own third. They must also agree on which device a request targets, which
 * one parse and one lookup guarantee.
 */

const TEAM_A = 'team-a';
const TEAM_B = 'team-b';
const PHONE_A = 'DEV-A';
const PHONE_B = 'DEV-B';
const UNKNOWN = 'DEV-X';

const DEVICES: Record<string, { teamId: string | null; busy: boolean; session_id: null }> = {
  [PHONE_A]: { teamId: TEAM_A, busy: false, session_id: null },
  [PHONE_B]: { teamId: TEAM_B, busy: false, session_id: null },
};

type Caller = { role: string; scopes: string; teamIds?: string[] };
const ALICE: Caller = { role: 'MEMBER', scopes: 'devices,sessions,read', teamIds: [TEAM_A] };
const ADMIN: Caller = { role: 'ADMIN', scopes: 'admin,devices,sessions,read' };

/** The /control guard chain, both guards on one counted lookup. */
function appWith(caller: Caller) {
  const lookups: string[] = [];
  const findDevice = async (udid: string) => {
    lookups.push(udid);
    return DEVICES[udid] ?? null;
  };
  const app = express();
  app.use((req, _res, next) => {
    (req as any).auth = {
      kind: 'user-session',
      userId: 'usr_caller',
      role: caller.role,
      scopes: caller.scopes,
      rateLimit: 100,
      teamIds: caller.teamIds,
    };
    next();
  });
  const router = express.Router();
  router.use(deviceTeamGuard({ findDevice }));
  router.use(deviceAccessGuard({ findDevice }));
  const reached = (_req: express.Request, res: express.Response) => res.json({ reached: true });
  router.post('/:udid/tap', reached);
  router.get('/:udid/screenshot', reached);
  router.get('/:udid/clipboard', reached);
  app.use('/control', router);
  return { app, lookups };
}

describe('the /control guards share one device lookup', () => {
  it("costs a member's tap one lookup, not one per guard", async () => {
    const { app, lookups } = appWith(ALICE);
    const res = await request(app).post(`/control/${PHONE_A}/tap`);
    expect(res.status, res.text).to.equal(200);
    expect(lookups).to.deep.equal([PHONE_A]);
  });

  it("costs a member's clipboard read, which both guards check, one lookup", async () => {
    const { app, lookups } = appWith(ALICE);
    const res = await request(app).get(`/control/${PHONE_A}/clipboard`);
    expect(res.status, res.text).to.equal(200);
    expect(lookups).to.deep.equal([PHONE_A]);
  });

  it("costs a member's screenshot one lookup", async () => {
    const { app, lookups } = appWith(ALICE);
    await request(app).get(`/control/${PHONE_A}/screenshot`);
    expect(lookups).to.deep.equal([PHONE_A]);
  });

  // The same count either way, so the time an answer takes can't tell a
  // hidden phone from an unknown udid either.
  it('costs a hidden phone and an unknown udid the same single lookup', async () => {
    const hidden = appWith(ALICE);
    await request(hidden.app).post(`/control/${PHONE_B}/tap`);
    const unknown = appWith(ALICE);
    await request(unknown.app).post(`/control/${UNKNOWN}/tap`);
    expect(hidden.lookups).to.deep.equal([PHONE_B]);
    expect(unknown.lookups).to.deep.equal([UNKNOWN]);
  });

  it("costs an admin's tap one lookup (the team guard skips admins)", async () => {
    const { app, lookups } = appWith(ADMIN);
    const res = await request(app).post(`/control/${PHONE_B}/tap`);
    expect(res.status, res.text).to.equal(200);
    expect(lookups).to.deep.equal([PHONE_B]);
  });

  it('does not share a lookup between two requests', async () => {
    const { app, lookups } = appWith(ALICE);
    await request(app).post(`/control/${PHONE_A}/tap`);
    await request(app).post(`/control/${PHONE_A}/tap`);
    expect(lookups).to.deep.equal([PHONE_A, PHONE_A]);
  });
});
