import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import DashboardRouter from '../../src/app/routers/dashboard';
import { prisma } from '../../src/prisma';
import {
  DAY_MS,
  dailyHeals,
  localDayStart,
  parseTzOffset,
} from '../../src/services/selector-health/healingTrend';

describe('healing trend: days', () => {
  it("reads the browser's offset from tz, and nothing else", () => {
    expect(parseTzOffset('330')).to.equal(330);
    expect(parseTzOffset('-300')).to.equal(-300);
    expect(parseTzOffset('900')).to.equal(0);
    expect(parseTzOffset('5.5')).to.equal(0);
    expect(parseTzOffset(undefined)).to.equal(0);
    expect(parseTzOffset(['330'])).to.equal(0);
  });

  it("starts a day at the caller's midnight", () => {
    // 2 Oct 20:00 UTC is 3 Oct 01:30 in India (+330).
    const t = Date.UTC(2026, 9, 2, 20, 0);
    expect(localDayStart(t, 330)).to.equal(Date.UTC(2026, 9, 2, 18, 30));
    expect(localDayStart(t, 0)).to.equal(Date.UTC(2026, 9, 2));
  });

  it('counts heals and AI heals per day, with every day of the period present', () => {
    const now = new Date(Date.UTC(2026, 9, 3, 12));
    const since = new Date(now.getTime() - 3 * DAY_MS);
    const days = dailyHeals(
      [
        { at: new Date(Date.UTC(2026, 9, 1, 9)), method: 'LLM' },
        { at: new Date(Date.UTC(2026, 9, 1, 10)), method: 'Fuzzy XML' },
        { at: new Date(Date.UTC(2026, 9, 3, 1)), method: 'Visual AI' },
      ],
      since,
      now,
      0,
    );
    expect(
      days.map((d) => [new Date(d.t).toISOString().slice(0, 10), d.heals, d.aiHeals]),
    ).to.deep.equal([
      ['2026-09-30', 0, 0],
      ['2026-10-01', 2, 1],
      ['2026-10-02', 0, 0],
      ['2026-10-03', 1, 1],
    ]);
  });

  it('puts a heal on the day the caller saw it', () => {
    const now = new Date(Date.UTC(2026, 9, 3, 12));
    const since = new Date(now.getTime() - 2 * DAY_MS);
    // 1 Oct 20:00 UTC is 2 Oct 01:30 in India.
    const days = dailyHeals(
      [{ at: new Date(Date.UTC(2026, 9, 1, 20)), method: null }],
      since,
      now,
      330,
    );
    expect(days.find((d) => d.heals === 1)?.t).to.equal(Date.UTC(2026, 9, 1, 18, 30));
  });
});

describe('GET /healing/summary: time and trend', () => {
  afterEach(() => sinon.restore());

  function app() {
    const a = express();
    a.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'user',
        userId: 'sa',
        role: 'SUPER_ADMIN',
        scopes: 'admin',
        teamIds: undefined,
      };
      next();
    });
    DashboardRouter.register(a as any);
    return a;
  }

  it('adds the time spent healing and one trend entry per day of the period', async () => {
    const recent = new Date(Date.now() - 60_000);
    const findMany = sinon.stub(prisma.sessionLog, 'findMany');
    findMany.onFirstCall().resolves([
      {
        session_id: 's-1',
        original_selector: '//a',
        healing_tier: 'LLM',
        createdAt: recent,
        duration: 2500,
      },
      {
        session_id: 's-1',
        original_selector: '//a',
        healing_tier: 'Fuzzy XML',
        createdAt: recent,
        duration: null,
      },
    ] as any);
    findMany.onSecondCall().resolves([
      {
        session_id: 's-0',
        original_selector: '//a',
        healing_tier: 'OCR',
        createdAt: new Date(Date.now() - 9 * DAY_MS),
        duration: 4000,
      },
    ] as any);
    sinon.stub(prisma.selectorState, 'count').resolves(0);

    const res = await request(app()).get('/healing/summary?windowDays=7&tz=0');

    expect(res.status).to.equal(200);
    expect(res.body.current.timeSpentMs).to.equal(2500);
    expect(res.body.prior.timeSpentMs).to.equal(4000);
    expect(res.body.trend).to.have.length(8);
    const sum = (k: 'heals' | 'aiHeals') =>
      res.body.trend.reduce((s: number, d: Record<string, number>) => s + d[k], 0);
    expect([sum('heals'), sum('aiHeals')]).to.deep.equal([2, 1]);
    const select = (findMany.firstCall.args[0] as { select: Record<string, unknown> }).select;
    expect(select).to.include({ createdAt: true, duration: true });
  });
});
