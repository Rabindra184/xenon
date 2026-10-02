import 'reflect-metadata';
import { expect } from 'chai';
import type { SinonStub } from 'sinon';
import request from 'supertest';
import { prisma } from '../../src/prisma';
import { useScratchDatabase } from '../helpers/scratch-database';
import {
  ADMIN,
  BUILD,
  DAY,
  FIX,
  HOUR,
  MEMBER_A,
  PHONE,
  READ_ONLY_A,
  SEL,
  USER,
  seedSelectorHealth,
  selectorHealthApp,
} from '../helpers/selector-health-fixture';
import { parseSelectorDetailQuery } from '../../src/services/selector-health/selectorDetail';

describe('selector panel: the query', () => {
  it('needs a selector, and reads the rest with defaults', () => {
    expect(parseSelectorDetailQuery({})).to.equal(null);
    expect(parseSelectorDetailQuery({ selector: '//a' })).to.deep.equal({
      strategy: '',
      selector: '//a',
      days: 30,
      tz: 0,
    });
    expect(
      parseSelectorDetailQuery({ strategy: 'xpath', selector: '//a', days: '7', tz: '330' }),
    ).to.deep.equal({ strategy: 'xpath', selector: '//a', days: 7, tz: 330 });
  });
});

describe('GET /healing/selectors/detail (real queries)', function () {
  this.timeout(90_000);
  const scratch = useScratchDatabase();

  before(async () => {
    await seedSelectorHealth(scratch.db);
  });

  const detail = (auth: Record<string, unknown>, query: Record<string, string>) =>
    request(selectorHealthApp(auth)).get('/healing/selectors/detail').query(query);

  it('answers everything the panel shows', async () => {
    const res = await detail(ADMIN, { strategy: 'xpath', selector: SEL.hot, days: '30', tz: '0' });
    expect(res.status).to.equal(200);
    const b = res.body;
    expect(b).to.deep.include({
      strategy: 'xpath',
      selector: SEL.hot,
      days: 30,
      heals: 4,
      sessions: 2,
      timeSpentMs: 18000,
      canAct: true,
    });
    expect(
      b.suggestions.map((s: Record<string, unknown>) => [
        s.selector,
        s.strategy,
        s.count,
        s.share,
        s.methods,
      ]),
    ).to.deep.equal([
      [FIX.hot, 'xpath', 3, 0.75, ['Visual AI']],
      [FIX.hotLlm, 'accessibility id', 1, 0.25, ['LLM']],
    ]);
    expect(b.suggestions[0].averageConfidence).to.be.closeTo(0.9, 1e-9);
    expect(b.platforms).to.deep.equal([{ name: 'android', count: 4 }]);
    expect(b.builds).to.deep.equal([
      { id: BUILD.id, name: BUILD.name, count: 3 },
      { id: null, name: 'No build', count: 1 },
    ]);
    expect(b.devices).to.deep.equal([{ udid: PHONE.shared, name: 'Shared Pixel', count: 4 }]);
    expect(b.recent).to.have.length(4);
    expect(b.recent[0]).to.include({
      sessionId: 'sh-s-shared-1',
      buildId: BUILD.id,
      device: 'Shared Pixel',
      method: 'Visual AI',
      healedSelector: FIX.hot,
    });
    expect(b.recent[3]).to.include({ sessionId: 'sh-s-shared-2', buildId: null, method: 'LLM' });
    expect(b.daily).to.have.length(31);
    expect(b.daily.reduce((s: number, d: { heals: number }) => s + d.heals, 0)).to.equal(4);
    expect(b.state).to.include({ status: 'active', brokeAgain: 2 });
    expect(b.activity).to.deep.equal([]);
  });

  it('shows who did what, newest first, naming nobody for a user who is gone', async () => {
    const b = (await detail(ADMIN, { strategy: 'xpath', selector: SEL.fixed })).body;
    expect(b.activity.map((a: Record<string, unknown>) => [a.action, a.by])).to.deep.equal([
      ['verified', null],
      ['marked_fixed', { id: USER.gone, name: null }],
    ]);
    expect(b.state).to.deep.include({ status: 'resolved', fixedBy: { id: USER.gone, name: null } });
  });

  it("gives a member a muted selector's reason, and who muted it", async () => {
    const b = (await detail(MEMBER_A, { strategy: 'xpath', selector: SEL.muted })).body;
    expect(b.activity).to.have.length(1);
    expect(b.activity[0]).to.deep.include({
      action: 'muted',
      by: { id: USER.priya, name: 'Priya' },
      reason: 'Screen being redesigned',
    });
    expect(b.state).to.deep.include({
      mutedBy: { id: USER.priya, name: 'Priya' },
      muteReason: 'Screen being redesigned',
    });
  });

  it("answers another team's selector exactly as one that doesn't exist", async () => {
    const hidden = await detail(MEMBER_A, { strategy: 'xpath', selector: SEL.bOnly });
    const missing = await detail(MEMBER_A, { strategy: 'xpath', selector: '//nothing/here' });
    expect(hidden.status).to.equal(404);
    expect(hidden.body).to.deep.equal({ error: 'not_found', message: 'Selector not found' });
    expect(missing.status).to.equal(404);
    expect(missing.body).to.deep.equal(hidden.body);
  });

  it('opens a heal recorded with no strategy, and a selector full of punctuation', async () => {
    expect((await detail(MEMBER_A, { strategy: '', selector: SEL.legacy })).body.heals).to.equal(1);
    expect((await detail(MEMBER_A, { strategy: 'xpath', selector: SEL.odd })).body.heals).to.equal(
      1,
    );
  });

  it("counts days in the caller's time zone", async () => {
    const b = (await detail(ADMIN, { strategy: 'xpath', selector: SEL.hot, days: '7', tz: '330' }))
      .body;
    expect(b.daily).to.have.length(8);
    for (const d of b.daily) expect((d.t + 330 * 60_000) % DAY).to.equal(0);
  });

  it('needs a selector', async () => {
    expect((await detail(ADMIN, {})).status).to.equal(400);
  });

  it('says a read-only caller cannot act', async () => {
    const b = (await detail(READ_ONLY_A, { strategy: 'xpath', selector: SEL.hot })).body;
    expect(b.canAct).to.equal(false);
  });

  it('reads each heal once without its session, and each session once', async () => {
    // 45 heals of one selector: odd ones on the shared phone, even ones on
    // team A's; two in three found the same fix.
    const now = Date.now();
    await scratch.db.sessionLog.createMany({
      data: Array.from({ length: 45 }, (_, i) => ({
        session_id: i % 2 ? 'sh-s-shared-1' : 'sh-s-a-1',
        command_name: 'findElement',
        url: '/element',
        method: 'POST',
        title: 'Find element',
        response: '{}',
        is_healed: true,
        original_strategy: 'id',
        original_selector: 'com.acme:id/many',
        healed_strategy: 'id',
        healed_selector: i % 3 ? 'com.acme:id/many_v2' : 'com.acme:id/many_v3',
        healing_tier: i % 2 ? 'LLM' : 'Fuzzy XML',
        healing_confidence: i % 3 ? 0.6 : null,
        duration: 100,
        createdAt: new Date(now - (i + 1) * HOUR),
      })),
    });

    const res = await detail(ADMIN, { strategy: 'id', selector: 'com.acme:id/many', days: '30' });

    expect(res.status).to.equal(200);
    // Attaching the session to each heal took most of a second for a selector
    // healed 50,000 times; the heals' sessions are read once each instead.
    const heals = (prisma.sessionLog.findMany as unknown as SinonStub).args.map((a) => a[0]);
    expect(heals).to.have.length(1);
    expect(heals[0].select).to.not.have.property('session');
    const sessions = await Promise.all(
      (prisma.session.findMany as unknown as SinonStub).returnValues,
    );
    expect(
      sessions
        .flat()
        .map((x: { id: string }) => x.id)
        .sort(),
    ).to.deep.equal(['sh-s-a-1', 'sh-s-shared-1']);
    const b = res.body;
    expect(b).to.deep.include({ heals: 45, sessions: 2, timeSpentMs: 4500 });
    expect(b.firstHealedAt).to.equal(new Date(now - 45 * HOUR).toISOString());
    expect(b.lastHealedAt).to.equal(new Date(now - HOUR).toISOString());
    expect(b.daily.reduce((s: number, d: { heals: number }) => s + d.heals, 0)).to.equal(45);
    expect(b.recent).to.have.length(20);
    expect(b.recent[0].at).to.equal(new Date(now - HOUR).toISOString());
    expect(b.suggestions.map((x: Record<string, unknown>) => [x.selector, x.count])).to.deep.equal([
      ['com.acme:id/many_v2', 30],
      ['com.acme:id/many_v3', 15],
    ]);
    expect(b.suggestions[0].methods).to.have.members(['LLM', 'Fuzzy XML']);
    expect(b.suggestions[0].averageConfidence).to.be.closeTo(0.6, 1e-9);
    expect(b.suggestions[1].averageConfidence).to.equal(null);
    expect(b.platforms).to.deep.equal([{ name: 'android', count: 45 }]);
    expect(b.builds).to.deep.equal([{ id: BUILD.id, name: BUILD.name, count: 45 }]);
    expect(b.devices).to.deep.equal([
      { udid: PHONE.a, name: 'Team A Galaxy', count: 23 },
      { udid: PHONE.shared, name: 'Shared Pixel', count: 22 },
    ]);
  });
});
