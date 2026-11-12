import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import log from '../../src/logger';
import { AutowaitService } from '../../src/services/autowait/AutowaitService';
import { OmniVisionService } from '../../src/services/omni-vision/OmniVisionService';
import { RecordingOrchestrator } from '../../src/services/recording/RecordingOrchestrator';
import { forgetSessionMemory } from '../../src/sessions/sessionMemory';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import * as DeviceService from '../../src/data-service/device-service';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { PhoneNetworkRestore } from '../../src/services/network/PhoneNetworkRestore';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { SessionDeviceLogs } from '../../src/services/logcat/SessionDeviceLogs';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';

/**
 * An observer recording (ENH-06) films a session and must stop as soon as
 * that session ends, or it goes on filming the next test on the phone.
 * forgetSessionMemory is what every ending calls, so it tells the
 * orchestrator. It is synchronous and its callers don't wait for it: the
 * orchestrator is told in the background, and a failure there is logged,
 * never thrown at the ending and never left as an unhandled rejection.
 */
describe('forgetSessionMemory and observer recordings', () => {
  let restoreRegs: () => void;
  let sessionEnded: sinon.SinonStub;
  let warn: sinon.SinonStub;

  /** Long enough for the background calls and their catch handlers to settle. */
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };

  beforeEach(() => {
    restoreRegs = saveRegistrations(
      RecordingOrchestrator,
      OmniVisionService,
      AutowaitService,
      IOSStreamService,
    );
    sessionEnded = sinon.stub().resolves();
    Container.set({ id: RecordingOrchestrator, value: { sessionEnded } });
    Container.set({ id: OmniVisionService, value: { forgetSession: sinon.stub() } });
    Container.set({ id: AutowaitService, value: { clearSession: sinon.stub() } });
    Container.set({
      id: IOSStreamService,
      value: { endSimulatorPreviews: sinon.stub().resolves() },
    });
    warn = sinon.stub(log, 'warn');
  });

  afterEach(() => {
    warn.restore();
    restoreRegs();
  });

  it('tells the orchestrator the session ended, once', async () => {
    forgetSessionMemory('S1');
    await settle();
    expect(sessionEnded.callCount).to.equal(1);
    expect(sessionEnded.firstCall.args).to.deep.equal(['S1']);
  });

  it('logs a failure there instead of leaving an unhandled rejection', async () => {
    sessionEnded.rejects(new Error('orchestrator down'));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.once('unhandledRejection', onUnhandled);
    try {
      expect(() => forgetSessionMemory('S1')).to.not.throw();
      await settle();
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
    expect(unhandled, 'unhandled rejections').to.deep.equal([]);
    expect(sessionEnded.callCount).to.equal(1);
    const messages = warn.getCalls().map((c) => String(c.args[0]));
    expect(messages.some((m) => m.includes('S1') && m.includes('orchestrator down'))).to.equal(
      true,
    );
  });

  it('logs, never throws, when the orchestrator cannot be built', async () => {
    // TypeDI doesn't keep a failed construction, so every ending would hit it.
    Container.set({
      id: RecordingOrchestrator,
      factory: () => {
        throw new Error('cannot build the orchestrator');
      },
    });
    expect(() => forgetSessionMemory('S1')).to.not.throw();
    await settle();
    const messages = warn.getCalls().map((c) => String(c.args[0]));
    expect(
      messages.some((m) => m.includes('S1') && m.includes('cannot build the orchestrator')),
    ).to.equal(true);
  });

  it('still tells the orchestrator when another drop throws', async () => {
    Container.set({
      id: OmniVisionService,
      value: {
        forgetSession: sinon.stub().throws(new Error('omni broken')),
      },
    });
    Container.set({
      id: AutowaitService,
      factory: () => {
        throw new Error('autowait cannot be built');
      },
    });
    Container.set({
      id: IOSStreamService,
      value: {
        endSimulatorPreviews: sinon.stub().throws(new Error('preview broken')),
      },
    });
    expect(() => forgetSessionMemory('S1')).to.not.throw();
    await settle();
    expect(sessionEnded.callCount).to.equal(1);
    expect(sessionEnded.firstCall.args).to.deep.equal(['S1']);
    const messages = warn.getCalls().map((c) => String(c.args[0]));
    for (const text of ['omni broken', 'autowait cannot be built', 'preview broken']) {
      expect(
        messages.some((m) => m.includes('S1') && m.includes(text)),
        text,
      ).to.equal(true);
    }
  });

  it('tells nothing for a session with no id', async () => {
    forgetSessionMemory(null);
    forgetSessionMemory(undefined);
    forgetSessionMemory('');
    await settle();
    expect(sessionEnded.called).to.equal(false);
  });
});

/**
 * The test's own quit releases the phone inside the cleanup lock, then waits
 * for the video archive and the driver's own delete (up to 30 s) before
 * forgetSessionMemory runs. An observer recording told only then films the
 * phone after it is free, so the next test on it. It is told first.
 */
describe('deleteSession tells the recordings before it frees the phone', function () {
  this.timeout(30_000);
  useScratchDatabase();
  let restoreRegs: () => void;
  let order: string[];
  let sessionEnded: sinon.SinonStub;

  beforeEach(() => {
    restoreRegs = saveRegistrations(
      RecordingOrchestrator,
      PhoneNetworkRestore,
      SessionMetricsService,
      SessionDeviceLogs,
    );
    order = [];
    sessionEnded = sinon.stub().callsFake(async (id: string) => {
      order.push(`recordings told ${id}`);
    });
    Container.set({ id: RecordingOrchestrator, value: { sessionEnded } });
    Container.set({
      id: PhoneNetworkRestore,
      value: { restoreSession: sinon.stub().resolves() },
    });
    Container.set({ id: SessionMetricsService, value: { stop: sinon.stub().resolves() } });
    Container.set({ id: SessionDeviceLogs, value: { stop: sinon.stub().resolves() } });
    sinon.stub(DeviceService, 'releaseSessionDevices').callsFake(async (id: string) => {
      order.push(`release ${id}`);
    });
    sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').resolves();
  });

  afterEach(() => {
    sinon.restore();
    restoreRegs();
  });

  it('the orchestrator hears of the ending before releaseSessionDevices', async () => {
    const next = sinon.stub().callsFake(async () => {
      order.push('driver quit');
    });

    await Container.get(SessionLifecycleService).deleteSession(next, 's-quit');

    expect(order.indexOf('recordings told s-quit'), order.join(', ')).to.be.greaterThan(-1);
    expect(order.indexOf('recordings told s-quit'), order.join(', ')).to.be.lessThan(
      order.indexOf('release s-quit'),
    );
  });

  it('an orchestrator that throws or rejects still lets the phone go', async () => {
    sessionEnded.rejects(new Error('orchestrator down'));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      await Container.get(SessionLifecycleService).deleteSession(
        sinon.stub().resolves(),
        's-reject',
      );
      Container.set({
        id: RecordingOrchestrator,
        factory: () => {
          throw new Error('cannot build the orchestrator');
        },
      });
      await Container.get(SessionLifecycleService).deleteSession(
        sinon.stub().resolves(),
        's-throw',
      );
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
    expect(unhandled, 'unhandled rejections').to.deep.equal([]);
    expect(order).to.include('release s-reject');
    expect(order).to.include('release s-throw');
  });
});
