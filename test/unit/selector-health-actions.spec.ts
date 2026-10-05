import 'reflect-metadata';
import { expect } from 'chai';
import request from 'supertest';
import { Container } from 'typedi';
import { useScratchDatabase } from '../helpers/scratch-database';
import {
  ADMIN,
  MEMBER_A,
  READ_ONLY_A,
  SEL,
  USER,
  seedSelectorHealth,
  selectorHealthApp,
} from '../helpers/selector-health-fixture';
import { SelectorStateService } from '../../src/services/SelectorStateService';

describe('POST /healing/selector/state (real queries)', function () {
  this.timeout(90_000);
  const scratch = useScratchDatabase();

  before(async () => {
    await seedSelectorHealth(scratch.db);
    // The service's transactions use the scratch database's own client.
    Container.set(
      SelectorStateService,
      new SelectorStateService(scratch.db as never, {
        emitToDashboardForSelector: async () => undefined,
      }),
    );
  });

  after(() => {
    Container.remove(SelectorStateService);
  });

  const act = (auth: Record<string, unknown>, body: Record<string, unknown>) =>
    request(selectorHealthApp(auth)).post('/healing/selector/state').send(body);

  it('lets a member mute a selector they can see, recording them and their reason', async () => {
    const res = await act(MEMBER_A, {
      original_strategy: 'id',
      original_selector: SEL.warm,
      action: 'mute',
      reason: '  Moving to the new cart  ',
    });
    expect(res.status).to.equal(200);
    const state = await scratch.db.selectorState.findUnique({
      where: {
        original_strategy_original_selector: {
          original_strategy: 'id',
          original_selector: SEL.warm,
        },
      },
    });
    expect(state?.status).to.equal('muted');
    const events = await scratch.db.selectorEvent.findMany({
      where: { original_selector: SEL.warm },
    });
    expect(events.map((e) => [e.action, e.user_id, e.reason])).to.deep.equal([
      ['muted', USER.priya, 'Moving to the new cart'],
    ]);
  });

  it("refuses a member another team's selector, as if it didn't exist", async () => {
    const res = await act(MEMBER_A, {
      original_strategy: 'xpath',
      original_selector: SEL.bOnly,
      action: 'mark_fixed',
    });
    expect(res.status).to.equal(404);
    expect(res.body).to.deep.equal({ error: 'not_found', message: 'Selector not found' });
    expect(
      await scratch.db.selectorState.count({ where: { original_selector: SEL.bOnly } }),
    ).to.equal(0);
  });

  it('lets an admin act on any selector', async () => {
    const res = await act(ADMIN, {
      original_strategy: 'xpath',
      original_selector: SEL.bOnly,
      action: 'mark_fixed',
    });
    expect(res.status).to.equal(200);
    expect(res.body.state.status).to.equal('pending');
  });

  it('refuses a caller without the sessions scope', async () => {
    const res = await act(READ_ONLY_A, {
      original_strategy: 'xpath',
      original_selector: SEL.hot,
      action: 'mute',
    });
    expect(res.status).to.equal(403);
  });

  it('marks fixed a selector recorded with no strategy', async () => {
    const res = await act(MEMBER_A, {
      original_strategy: '',
      original_selector: SEL.legacy,
      action: 'mark_fixed',
    });
    expect(res.status).to.equal(200);
    const state = await scratch.db.selectorState.findFirst({
      where: { original_selector: SEL.legacy },
    });
    expect(state).to.include({ original_strategy: '', status: 'pending' });
  });

  it('refuses a reason over 500 characters', async () => {
    const res = await act(MEMBER_A, {
      original_strategy: 'xpath',
      original_selector: SEL.hot,
      action: 'mute',
      reason: 'x'.repeat(501),
    });
    expect(res.status).to.equal(400);
  });
});
