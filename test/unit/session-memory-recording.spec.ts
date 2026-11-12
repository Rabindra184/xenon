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
