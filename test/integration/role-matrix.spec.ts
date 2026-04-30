import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { apiKeysRouter } from '../../src/app/routers/apikeys';
import { teamsRouter } from '../../src/app/routers/teams';
import { processesRouter } from '../../src/app/routers/processes';
import { usersRouter } from '../../src/app/routers/users';
import { prisma } from '../../src/prisma';
import { seedUser, SeededUser } from '../helpers/seedUser';

interface Case {
  name: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: any | (() => any);
  expect: { SUPER_ADMIN: number; ADMIN: number; MEMBER: number };
}

// scopesForRole now grants ADMIN the full 'admin,devices,sessions,read' set on
// cookie sessions (the user themselves logged in via /login). Token-default
// scopes in /profile/tokens stay narrower so an admin's CI token doesn't
// auto-grant 'admin'. Both SUPER_ADMIN and ADMIN should pass these routes;
// MEMBER is the floor and gets 403 from roleGuard before scopeGuard runs.
const CASES: Case[] = [
  {
    name: 'apikeys list',
    method: 'GET',
    path: '/apikeys',
    expect: { SUPER_ADMIN: 200, ADMIN: 200, MEMBER: 403 },
  },
  {
    name: 'apikeys create',
    method: 'POST',
    path: '/apikeys',
    body: { name: 'cli', scopes: ['read'] },
    expect: { SUPER_ADMIN: 200, ADMIN: 200, MEMBER: 403 },
  },
  {
    name: 'teams list',
    method: 'GET',
    path: '/teams',
    expect: { SUPER_ADMIN: 200, ADMIN: 200, MEMBER: 403 },
  },
  {
    name: 'processes list',
    method: 'GET',
    path: '/processes',
    expect: { SUPER_ADMIN: 200, ADMIN: 200, MEMBER: 403 },
  },
  {
    name: 'users list',
    method: 'GET',
    path: '/users',
    expect: { SUPER_ADMIN: 200, ADMIN: 200, MEMBER: 403 },
  },
  {
    name: 'users create (member)',
    method: 'POST',
    path: '/users',
    body: () => ({
      email: `rmcase-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@xenon.local`,
      name: 'RM',
      role: 'MEMBER',
    }),
    expect: { SUPER_ADMIN: 201, ADMIN: 201, MEMBER: 403 },
  },
];

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/apikeys', apiKeysRouter());
  app.use('/teams', teamsRouter());
  app.use('/processes', processesRouter());
  app.use('/users', usersRouter());
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
    await prisma.user.deleteMany({ where: { email: { contains: 'rmcase-' } } });
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
        const body = typeof c.body === 'function' ? c.body() : c.body;
        const r = body ? await reqBuilder.send(body) : await reqBuilder;
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
