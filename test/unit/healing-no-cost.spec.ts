import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import axios from 'axios';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import DashboardRouter, { aggregateHotspots } from '../../src/app/routers/dashboard';
import { NotificationService } from '../../src/services/NotificationService';
import { prisma } from '../../src/prisma';

const heal = (tier: string) => ({
  session_id: 's-1',
  original_strategy: 'xpath',
  original_selector: '//a',
  healed_strategy: 'xpath',
  healed_selector: '//b',
  healing_confidence: 0.9,
  healing_tier: tier,
  createdAt: new Date(),
  duration: 1000,
});

describe('Selector Health reports no cost', () => {
  afterEach(() => sinon.restore());

  function app() {
    const a = express();
    a.use(express.json());
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

  it('leaves cost out of the hotspot aggregation', async () => {
    sinon.stub(prisma.sessionLog, 'findMany').resolves([heal('LLM'), heal('OCR')] as any);
    sinon.stub(prisma.selectorState, 'findMany').resolves([]);

    const agg = await aggregateHotspots({ windowDays: 7, limit: 10 });

    expect(agg).to.not.have.property('estCostUsd');
    expect(agg.totalHeals).to.equal(2);
  });

  it('leaves cost out of the summary', async () => {
    sinon.stub(prisma.sessionLog, 'findMany').resolves([heal('LLM')] as any);
    sinon.stub(prisma.selectorState, 'count').resolves(0);

    const res = await request(app()).get('/healing/summary?windowDays=7');

    expect(res.status).to.equal(200);
    expect(res.body.current).to.not.have.property('estCostUsd');
    expect(res.body.prior).to.not.have.property('estCostUsd');
  });

  it('leaves cost out of the CI gate', async () => {
    sinon
      .stub(prisma.sessionLog, 'findMany')
      .resolves(Array.from({ length: 5 }, () => heal('LLM')) as any);
    sinon.stub(prisma.selectorState, 'findMany').resolves([]);

    const res = await request(app()).get('/healing/hotspots/violations');

    expect(res.status).to.equal(200);
    expect(res.body.violationCount).to.equal(1);
    expect(res.body).to.not.have.property('estCostUsd');
  });

  it('sends a digest with no cost in it', async () => {
    const post = sinon.stub(axios, 'post').resolves({ status: 200 } as any);
    sinon.stub(NotificationService.prototype, 'getConfigs').resolves([
      {
        id: 'w-1',
        url: 'https://hooks.example.test/x',
        type: 'slack',
        active: true,
        events: JSON.stringify(['selector_health_digest']),
        payloadTemplate: null,
      } as any,
    ]);

    await Container.get(NotificationService).dispatchEvent('selector_health_digest', {
      windowDays: 7,
      totalHeals: 3,
      distinctSelectors: 1,
      hotspots: [],
    });

    const text = (post.firstCall.args[1] as { text: string }).text;
    expect(text).to.include('3 heals across 1 selectors');
    expect(text).to.not.match(/\$|est\./);
  });
});
