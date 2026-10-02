import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import DashboardRouter from '../../src/app/routers/dashboard';
import { seriesFor, sessionMetricsBody } from '../../src/services/metrics/metricsBody';
import { useScratchDatabase } from '../helpers/scratch-database';

const row = (at: number, over: Record<string, unknown> = {}) => ({
  at,
  device_cpu_pct: 20,
  device_mem_mb: 2800,
  device_mem_total: 5620.8,
  app_cpu_pct: 5,
  app_mem_mb: 300,
  app_id: 'com.acme.shop',
  ...over,
});

describe('session metrics: the response', () => {
  it('says what each platform can record', () => {
    expect(seriesFor('Android')).to.deep.equal({
      deviceCpu: true,
      deviceMem: true,
      appCpu: true,
      appMem: true,
    });
    expect(seriesFor('ios')).to.deep.equal({
      deviceCpu: true,
      deviceMem: false,
      appCpu: false,
      appMem: false,
    });
    expect(seriesFor('')).to.deep.equal({
      deviceCpu: false,
      deviceMem: false,
      appCpu: false,
      appMem: false,
    });
  });

  it('passes on whether a running session is being sampled, and nothing for an ended one', () => {
    expect(sessionMetricsBody('android', [], 'off').recording).to.equal('off');
    expect(sessionMetricsBody('android', []).recording).to.equal(null);
  });

  it('answers samples in time order, named by the last app recorded', () => {
    const body = sessionMetricsBody('android', [
      row(4000, { app_id: null, app_cpu_pct: null, app_mem_mb: null }),
      row(0, { app_id: 'com.old.app' }),
      row(2000),
    ]);
    expect(body.samples.map((s) => s.t)).to.deep.equal([0, 2000, 4000]);
    expect(body.appId).to.equal('com.acme.shop');
    expect(body.intervalMs).to.equal(2000);
    expect(body.samples[1]).to.deep.equal({
      t: 2000,
      deviceCpu: 20,
      deviceMemMb: 2800,
      deviceMemTotalMb: 5620.8,
      appCpu: 5,
      appMemMb: 300,
    });
  });
});

describe('GET /session/:sessionId/metrics', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();

  function app() {
    const a = express();
    a.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'user',
        userId: 'sa',
        role: 'SUPER_ADMIN',
        scopes: ['admin', 'devices', 'sessions', 'read'],
        teamIds: undefined,
      };
      next();
    });
    DashboardRouter.register(a as any);
    return a;
  }

  beforeEach(async () => {
    await scratch.db.sessionMetric.deleteMany({});
    await scratch.db.session.deleteMany({});
  });

  it("answers a session's samples", async () => {
    await scratch.db.session.create({
      data: {
        id: 'metrics-1',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'n',
        has_live_video: false,
        device_udid: 'phone-m',
        device_platform: 'android',
        device_version: '10',
      },
    });
    await scratch.db.sessionMetric.createMany({
      data: [
        { session_id: 'metrics-1', ...row(2000) },
        { session_id: 'metrics-1', ...row(0) },
      ],
    });

    const res = await request(app()).get('/session/metrics-1/metrics');

    expect(res.status).to.equal(200);
    expect(res.body.platform).to.equal('android');
    expect(res.body.samples.map((s: any) => s.t)).to.deep.equal([0, 2000]);
    expect(res.body.series.appMem).to.equal(true);
  });

  it('says a running session nothing samples is not recorded', async () => {
    await scratch.db.session.create({
      data: {
        id: 'metrics-2',
        status: 'running',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'n',
        has_live_video: false,
        device_udid: 'sim-1',
        device_platform: 'ios',
        device_version: '18.0',
      },
    });

    const res = await request(app()).get('/session/metrics-2/metrics');

    expect(res.status).to.equal(200);
    expect(res.body.recording).to.equal('off');
  });
});
