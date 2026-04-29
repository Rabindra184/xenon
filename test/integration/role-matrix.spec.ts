import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { apiKeysRouter } from '../../src/app/routers/apikeys';
import { teamsRouter } from '../../src/app/routers/teams';
import { processesRouter } from '../../src/app/routers/processes';
import { seedUser, SeededUser } from '../helpers/seedUser';

interface Case {
  name: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: any;
  expect: { SUPER_ADMIN: number; ADMIN: number; MEMBER: number };
}

// NOTE on the ADMIN column below.
// Each of these routers is gated by roleGuard('ADMIN') AND scopeGuard(['admin']).
// authMiddleware → scopesForRole derives scopes from role:
//   SUPER_ADMIN → 'admin'
//   ADMIN       → 'devices,sessions,read'   (NO 'admin' scope)
//   MEMBER      → 'sessions,read'
// So today an ADMIN user passes roleGuard but is rejected by scopeGuard with 403
// {error:'insufficient scope'}. That is intentional — these endpoints are
// SUPER_ADMIN-only writes from the dashboard's perspective.
// PR-B / PR-C will expand the matrix as the role/scope alignment is revisited.
const CASES: Case[] = [
  {
    name: 'apikeys list',
    method: 'GET',
    path: '/apikeys',
    expect: { SUPER_ADMIN: 200, ADMIN: 403, MEMBER: 403 },
  },
  {
    name: 'apikeys create',
    method: 'POST',
    path: '/apikeys',
    body: { name: 'cli', scopes: ['read'] },
    expect: { SUPER_ADMIN: 200, ADMIN: 403, MEMBER: 403 },
  },
  {
    name: 'teams list',
    method: 'GET',
    path: '/teams',
    expect: { SUPER_ADMIN: 200, ADMIN: 403, MEMBER: 403 },
  },
  {
    name: 'processes list',
    method: 'GET',
    path: '/processes',
    expect: { SUPER_ADMIN: 200, ADMIN: 403, MEMBER: 403 },
  },
];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/apikeys', apiKeysRouter());
  app.use('/teams', teamsRouter());
  app.use('/processes', processesRouter());
  return app;
}

describe('role matrix (integration)', function () {
  this.timeout(60_000);
  let users: { SUPER_ADMIN: SeededUser; ADMIN: SeededUser; MEMBER: SeededUser };

  before(async () => {
    users = {
      SUPER_ADMIN: await seedUser('SUPER_ADMIN'),
      ADMIN: await seedUser('ADMIN'),
      MEMBER: await seedUser('MEMBER'),
    };
  });

  after(async () => {
    await users.SUPER_ADMIN.cleanup();
    await users.ADMIN.cleanup();
    await users.MEMBER.cleanup();
  });

  CASES.forEach((c) => {
    (['SUPER_ADMIN', 'ADMIN', 'MEMBER'] as const).forEach((role) => {
      it(`${role} ${c.method} ${c.path} → expect ${c.expect[role]}`, async () => {
        const app = buildApp();
        const expected = c.expect[role];
        const reqBuilder = request(app)[c.method.toLowerCase() as 'get' | 'post' | 'delete'](c.path).set(
          'Cookie',
          users[role].cookie,
        );
        const r = c.body ? await reqBuilder.send(c.body) : await reqBuilder;
        if (expected >= 200 && expected < 300) {
          expect(
            r.status,
            `${role} ${c.method} ${c.path} body=${JSON.stringify(r.body)}`,
          ).to.be.lessThan(300);
        } else {
          expect(r.status, `${role} ${c.method} ${c.path} body=${JSON.stringify(r.body)}`).to.equal(
            expected,
          );
        }
      });
    });
  });
});
