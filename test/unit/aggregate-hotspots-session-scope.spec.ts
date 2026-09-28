import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { prisma } from '../../src/prisma';
import DashboardRouter, { aggregateHotspots } from '../../src/app/routers/dashboard';

/**
 * Selector Health counts only heals from sessions the caller may see. The
 * caller's rule (visibleSessionWhere) is an `OR`, and aggregateHotspots has a
 * session filter of its own (platform, build), so the two are combined under
 * `AND`: neither may overwrite the other.
 */
describe('aggregateHotspots — session scope', () => {
  let findMany: sinon.SinonStub;

  const visible = {
    OR: [
      { device_udid: { in: ['shared', 'phone-a'] } },
      { user_id: 'u-a', device_udid: { notIn: ['shared', 'phone-a', 'phone-b'] } },
    ],
  };
  const sessionFilter = () => findMany.firstCall.args[0].where.session;

  beforeEach(() => {
    findMany = sinon.stub(prisma.sessionLog, 'findMany').resolves([]);
    sinon.stub(prisma.selectorState, 'findMany').resolves([]);
  });

  afterEach(() => sinon.restore());

  it('filters no session when given no scope, platform or build', async () => {
    await aggregateHotspots({ windowDays: 7, limit: 10 });
    expect(sessionFilter()).to.equal(undefined);
  });

  it('keeps the platform and build filter as it was when given no scope', async () => {
    await aggregateHotspots({ windowDays: 7, limit: 10, platform: 'android', buildId: 'b-1' });
    expect(sessionFilter()).to.deep.equal({ device_platform: 'android', build_id: 'b-1' });
  });

  it('applies the scope on its own when there is no platform or build', async () => {
    await aggregateHotspots({ windowDays: 7, limit: 10, sessionWhere: visible });
    expect(sessionFilter()).to.deep.equal(visible);
  });

  it('combines the scope with platform and build under AND, overwriting neither', async () => {
    await aggregateHotspots({
      windowDays: 7,
      limit: 10,
      platform: 'android',
      buildId: 'b-1',
      sessionWhere: visible,
    });
    expect(sessionFilter()).to.deep.equal({
      AND: [{ device_platform: 'android', build_id: 'b-1' }, visible],
    });
  });

  it('keeps both ORs when the scope and another filter each carry one', async () => {
    // A spread would keep only the second OR.
    const other = { OR: [{ device_platform: 'android' }, { device_platform: 'ios' }] };
    await aggregateHotspots({ windowDays: 7, limit: 10, buildId: 'b-1', sessionWhere: other });
    expect(sessionFilter()).to.deep.equal({ AND: [{ build_id: 'b-1' }, other] });
  });
});

/**
 * The three Selector Health reads pass the caller's rule to aggregateHotspots.
 * An admin gets no session filter, as before.
 */
describe('Selector Health reads — scoped to the caller’s sessions', () => {
  let findMany: sinon.SinonStub;

  const DEVICES = [
    { udid: 'shared', teamId: null },
    { udid: 'phone-a', teamId: 'team-a' },
    { udid: 'phone-b', teamId: 'team-b' },
  ];
  const memberWhere = {
    OR: [
      { device_udid: { in: ['shared', 'phone-a'] } },
      { user_id: 'u-a', device_udid: { notIn: ['shared', 'phone-a', 'phone-b'] } },
    ],
  };

  beforeEach(() => {
    findMany = sinon.stub(prisma.sessionLog, 'findMany').resolves([]);
    sinon.stub(prisma.selectorState, 'findMany').resolves([]);
    sinon.stub(prisma.device, 'findMany').resolves(DEVICES.map((d) => ({ ...d })) as any);
  });

  afterEach(() => sinon.restore());

  function app(auth: Record<string, unknown>) {
    const a = express();
    a.use((req, _res, next) => {
      (req as any).auth = auth;
      next();
    });
    DashboardRouter.register(a as any);
    return a;
  }
  const member = { role: 'MEMBER', userId: 'u-a', teamIds: ['team-a'], scopes: [] };
  const admin = { role: 'ADMIN', userId: 'adm', teamIds: undefined, scopes: ['admin'] };

  const ROUTES = [
    '/healing/hotspots',
    '/healing/hotspots/violations?build=b-1',
    '/healing/selector-health',
  ];

  for (const url of ROUTES) {
    it(`${url}: a member counts only the sessions they may see`, async () => {
      const r = await request(app(member)).get(url);
      expect(r.status).to.equal(200);
      const session = findMany.firstCall.args[0].where.session;
      if (url.includes('build=')) {
        expect(session).to.deep.equal({ AND: [{ build_id: 'b-1' }, memberWhere] });
      } else {
        expect(session).to.deep.equal(memberWhere);
      }
    });

    it(`${url}: an admin counts every session`, async () => {
      const r = await request(app(admin)).get(url);
      expect(r.status).to.equal(200);
      const session = findMany.firstCall.args[0].where.session;
      if (url.includes('build=')) {
        expect(session).to.deep.equal({ build_id: 'b-1' });
      } else {
        expect(session).to.equal(undefined);
      }
    });
  }
});
