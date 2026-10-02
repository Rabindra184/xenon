import 'reflect-metadata';
import { expect } from 'chai';
import request from 'supertest';
import { useScratchDatabase } from '../helpers/scratch-database';
import {
  ADMIN,
  FIX,
  HOUR,
  MEMBER_A,
  READ_ONLY_A,
  SEL,
  USER,
  seedSelectorHealth,
  selectorHealthApp,
} from '../helpers/selector-health-fixture';
import { parseSelectorListQuery } from '../../src/services/selector-health/selectorList';

describe('selector list: the query', () => {
  it('reads every field, and falls back for anything it does not know', () => {
    expect(parseSelectorListQuery({})).to.deep.equal({
      tab: 'fix',
      days: 30,
      q: '',
      platform: null,
      method: null,
      sort: 'heals',
      page: 1,
      pageSize: 50,
    });
    expect(
      parseSelectorListQuery({
        tab: 'muted',
        days: '7',
        q: '  confirm ',
        platform: 'ios',
        method: 'LLM',
        sort: 'time',
        page: '3',
        pageSize: '20',
      }),
    ).to.deep.equal({
      tab: 'muted',
      days: 7,
      q: 'confirm',
      platform: 'ios',
      method: 'LLM',
      sort: 'time',
      page: 3,
      pageSize: 20,
    });
    expect(
      parseSelectorListQuery({
        tab: 'active',
        days: '9999',
        sort: 'random',
        page: '-2',
        pageSize: '1000',
      }),
    ).to.include({ tab: 'fix', days: 365, sort: 'heals', page: 1, pageSize: 100 });
  });
});

describe('GET /healing/selectors (real queries)', function () {
  this.timeout(90_000);
  const scratch = useScratchDatabase();

  before(async () => {
    await seedSelectorHealth(scratch.db);
  });

  const list = (auth: Record<string, unknown>, qs = '') =>
    request(selectorHealthApp(auth)).get(`/healing/selectors${qs}`);
  const names = (res: request.Response) =>
    res.body.items.map((i: { selector: string }) => i.selector);

  it('lists what to fix, most heals first, with every tab counted', async () => {
    const res = await list(ADMIN);
    expect(res.status).to.equal(200);
    expect(names(res)).to.deep.equal([SEL.hot, SEL.bOnly, SEL.warm, SEL.legacy, SEL.odd]);
    expect(res.body.counts).to.deep.equal({ fix: 5, verifying: 1, fixed: 1, muted: 2 });
    expect(res.body).to.include({
      tab: 'fix',
      days: 30,
      page: 1,
      pageSize: 50,
      total: 5,
      canAct: true,
    });
  });

  it('describes each selector: heals, sessions, time, method, suggestion and status', async () => {
    const hot = (await list(ADMIN)).body.items[0];
    expect(hot).to.deep.include({
      strategy: 'xpath',
      selector: SEL.hot,
      heals: 4,
      sessions: 2,
      timeSpentMs: 18000,
      topMethod: 'Visual AI',
    });
    expect(hot.suggestion).to.deep.equal({ selector: FIX.hot, strategy: 'xpath', share: 0.75 });
    expect(hot.state).to.include({ status: 'active', brokeAgain: 2 });
    expect(Date.now() - Date.parse(hot.lastHealedAt)).to.be.within(0.9 * HOUR, 1.5 * HOUR);
  });

  it('lists a heal with no strategy under an empty one', async () => {
    const legacy = (await list(ADMIN)).body.items.find(
      (i: { selector: string }) => i.selector === SEL.legacy,
    );
    expect(legacy).to.deep.include({ strategy: '', heals: 1 });
  });

  it('shows a member only selectors healed in sessions they can see, and counts only those', async () => {
    const res = await list(MEMBER_A);
    expect(names(res)).to.deep.equal([SEL.hot, SEL.warm, SEL.legacy, SEL.odd]);
    expect(res.body.counts).to.deep.equal({ fix: 4, verifying: 1, fixed: 1, muted: 1 });
  });

  it('sorts by most recent and by most time spent healing', async () => {
    expect(names(await list(ADMIN, '?sort=recent'))).to.deep.equal([
      SEL.hot,
      SEL.legacy,
      SEL.odd,
      SEL.bOnly,
      SEL.warm,
    ]);
    expect(names(await list(ADMIN, '?sort=time'))).to.deep.equal([
      SEL.warm,
      SEL.hot,
      SEL.bOnly,
      SEL.legacy,
      SEL.odd,
    ]);
  });

  it('searches the selector and its suggested fix, taking the text literally', async () => {
    expect(names(await list(ADMIN, '?q=CONFIRM'))).to.deep.equal([SEL.hot]);
    expect(names(await list(ADMIN, `?q=${encodeURIComponent('cart_total_v2')}`))).to.deep.equal([
      SEL.warm,
    ]);
    expect(names(await list(ADMIN, `?q=${encodeURIComponent('%')}`))).to.deep.equal([SEL.odd]);
  });

  it('filters what to fix by platform and by healing method, keeping the counts whole', async () => {
    expect(names(await list(ADMIN, '?platform=ios'))).to.deep.equal([SEL.bOnly]);
    const llm = await list(ADMIN, '?method=LLM');
    expect(names(llm)).to.deep.equal([SEL.hot]);
    expect(llm.body.items[0]).to.deep.include({ heals: 1, topMethod: 'LLM' });
    expect(llm.body.counts.fix).to.equal(5);
  });

  it('pages, and shows the last page for a page past the end', async () => {
    expect(names(await list(ADMIN, '?pageSize=2&page=2'))).to.deep.equal([SEL.warm, SEL.legacy]);
    const past = await list(ADMIN, '?pageSize=2&page=99');
    expect(past.body.page).to.equal(3);
    expect(past.body.total).to.equal(5);
    expect(names(past)).to.deep.equal([SEL.odd]);
  });

  it('lists selectors being verified, with their progress and who marked them fixed', async () => {
    const res = await list(MEMBER_A, '?tab=verifying');
    expect(names(res)).to.deep.equal([SEL.pending]);
    expect(res.body.items[0].heals).to.equal(1);
    expect(res.body.items[0].state).to.deep.include({
      status: 'pending',
      cleanBuilds: 2,
      fixedBy: { id: USER.priya, name: 'Priya' },
    });
  });

  it('lists selectors fixed in the period, with or without a heal in it', async () => {
    expect(names(await list(ADMIN, '?tab=fixed'))).to.deep.equal([SEL.fixed]);
    expect(names(await list(ADMIN, '?tab=fixed&days=90'))).to.deep.equal([SEL.fixed, SEL.fixedOld]);
    const week = await list(ADMIN, '?tab=fixed&days=7');
    expect(names(week)).to.deep.equal([SEL.fixed]);
    expect(week.body.items[0]).to.deep.include({
      heals: 0,
      sessions: 0,
      lastHealedAt: null,
      suggestion: null,
    });
  });

  it('names nobody for an action by a user who is gone', async () => {
    const fixed = (await list(ADMIN, '?tab=fixed')).body.items[0];
    expect(fixed.state.fixedBy).to.deep.equal({ id: USER.gone, name: null });
  });

  it('lists muted selectors with who muted them and why, only those a member can see', async () => {
    const res = await list(MEMBER_A, '?tab=muted');
    expect(names(res)).to.deep.equal([SEL.muted]);
    expect(res.body.items[0].state).to.deep.include({
      status: 'muted',
      mutedBy: { id: USER.priya, name: 'Priya' },
      muteReason: 'Screen being redesigned',
    });
    expect(names(await list(ADMIN, '?tab=muted'))).to.deep.equal([SEL.muted, SEL.mutedB]);
  });

  it('searches a status tab by selector', async () => {
    expect(names(await list(ADMIN, '?tab=muted&q=team-b'))).to.deep.equal([SEL.mutedB]);
  });

  it('tells a caller without the sessions scope that they cannot act', async () => {
    expect((await list(READ_ONLY_A)).body.canAct).to.equal(false);
  });
});
