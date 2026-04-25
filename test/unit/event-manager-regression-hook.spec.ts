import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';

import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SelectorStateService } from '../../src/services/SelectorStateService';
import { SocketServer } from '../../src/services/SocketServer';
import { prisma } from '../../src/prisma';

/**
 * Regression-hook tests for `DashboardEventManager.afterSessionCommand`.
 *
 * The hook is the contract bridge between the heal write path and
 * SelectorStateService: when a heal lands for a (strategy, selector) tuple
 * that someone has marked Fixed/Resolved, the row must flip back to Active
 * with regression_count++. The call is fire-and-forget so the heal write
 * itself must remain robust to SelectorState lookup failures.
 */
describe('DashboardEventManager.afterSessionCommand — regression hook', () => {
  const SESSION_ID = 'session-1';
  const STRATEGY = 'xpath';
  const SELECTOR = '//x';

  let onHealRecordedStub: sinon.SinonStub;
  let sessionLogCreateStub: sinon.SinonStub;
  let socketStub: { emitToDashboard: sinon.SinonStub };

  beforeEach(() => {
    // Stub the prototype so any `Container.get(SelectorStateService)` instance
    // (including the singleton the production code resolves) routes through us.
    onHealRecordedStub = sinon
      .stub(SelectorStateService.prototype, 'onHealRecorded')
      .resolves(null);

    // Capture heal writes without touching the real database.
    sessionLogCreateStub = sinon
      .stub(prisma.sessionLog, 'create' as any)
      .resolves({ id: 'mock-id', createdAt: new Date('2026-04-25T00:00:00.000Z') } as any);

    // Fake session whose getId/getDevice/getXenonOption are no-ops sufficient
    // for the heal-broadcast block to run without error.
    const fakeSession: any = {
      getId: () => SESSION_ID,
      getDevice: () => ({ udid: 'udid-1', name: 'Pixel 7', platform: 'Android' }),
      getXenonOption: () => undefined,
      getScreenShot: async () => '',
    };
    sinon.stub(SESSION_MANAGER, 'getSession').returns(fakeSession);

    // Replace the SocketServer singleton with a stub so `emitToDashboard` is
    // a recordable no-op rather than touching real socket.io infrastructure.
    socketStub = { emitToDashboard: sinon.stub() };
    Container.set(SocketServer, socketStub);
  });

  afterEach(() => {
    sinon.restore();
    Container.remove(SocketServer);
  });

  it('calls SelectorStateService.onHealRecorded when is_healed=true and strategy+selector are present', async () => {
    await DASHBORD_EVENT_MANAGER.afterSessionCommand(
      SESSION_ID,
      'findElement',
      null,
      { body: ['xpath', '//x'], method: 'POST', originalUrl: '/findElement' } as any,
      {} as any,
      JSON.stringify({ value: { ELEMENT: 'el-1' } }),
      {
        originalSelector: '//x',
        originalStrategy: 'xpath',
        healedSelector: 'login-btn',
        healedStrategy: 'accessibility id',
        confidence: 0.9,
        tier: 4,
      },
    );

    expect(sessionLogCreateStub.calledOnce).to.equal(true);
    expect(onHealRecordedStub.calledOnce).to.equal(true);
    expect(onHealRecordedStub.firstCall.args[0]).to.deep.equal({
      strategy: STRATEGY,
      selector: SELECTOR,
      sessionId: SESSION_ID,
    });
  });

  it('does NOT call onHealRecorded when is_healed=false', async () => {
    await DASHBORD_EVENT_MANAGER.afterSessionCommand(
      SESSION_ID,
      'findElement',
      null,
      { body: ['xpath', '//x'], method: 'POST', originalUrl: '/findElement' } as any,
      {} as any,
      JSON.stringify({ value: { ELEMENT: 'el-1' } }),
      // No healingInfo — heal did not happen.
    );

    expect(sessionLogCreateStub.calledOnce).to.equal(true);
    expect(onHealRecordedStub.called).to.equal(false);
  });

  it('swallows errors from onHealRecorded so the heal write succeeds', async () => {
    onHealRecordedStub.rejects(new Error('boom'));

    let thrown: any = null;
    try {
      await DASHBORD_EVENT_MANAGER.afterSessionCommand(
        SESSION_ID,
        'findElement',
        null,
        { body: ['xpath', '//x'], method: 'POST', originalUrl: '/findElement' } as any,
        {} as any,
        JSON.stringify({ value: { ELEMENT: 'el-1' } }),
        {
          originalSelector: '//x',
          originalStrategy: 'xpath',
          healedSelector: 'login-btn',
          healedStrategy: 'accessibility id',
          confidence: 0.9,
          tier: 4,
        },
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).to.equal(null);
    expect(sessionLogCreateStub.calledOnce).to.equal(true);
    expect(onHealRecordedStub.calledOnce).to.equal(true);

    // Give the fire-and-forget .catch() a tick to settle so the test does
    // not exit while an unhandled rejection is still in flight.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
