import 'reflect-metadata';
import { expect } from 'chai';
import request from 'supertest';
import { useScratchDatabase } from '../helpers/scratch-database';
import {
  ADMIN,
  BUILD,
  DAY,
  FIX,
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
});
