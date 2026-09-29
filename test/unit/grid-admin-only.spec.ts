import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import GridRouter from '../../src/app/routers/grid';
import { scopesForRole } from '../../src/middleware/authMiddleware';

/**
 * Two grid reads are operator tools, not a member's:
 * - GET /logs/requests is every internal HTTP call the server made, including
 *   control proxied to phones on other nodes (with what was typed) and new
 *   sessions forwarded to nodes (with their session ids);
 * - GET /node/status and /node/:host/status list every attached phone.
 * Both answered any member. They are now admin-only, like /processes.
 */
describe('grid operator reads are admin-only', () => {
  function app(role: 'MEMBER' | 'ADMIN') {
    const a = express();
    a.use((req: any, _res, next) => {
      req.auth = {
        kind: 'user-session',
        userId: `u-${role}`,
        role,
        scopes: scopesForRole(role),
        teamIds: role === 'ADMIN' ? undefined : ['team-a'],
      };
      next();
    });
    GridRouter.register(a as any, { bindHostOrIp: '127.0.0.1' } as any);
    return a;
  }

  for (const url of ['/logs/requests', '/node/status', '/node/10.0.0.2/status']) {
    it(`a member gets 403 from GET ${url}`, async () => {
      const r = await request(app('MEMBER')).get(url);
      expect(r.status).to.equal(403);
    });
  }

  it('an admin still reads the request log', async () => {
    const r = await request(app('ADMIN')).get('/logs/requests');
    expect(r.status).to.equal(200);
  });
});
