import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { SessionLifecycleService } from '../../../src/services/SessionLifecycleService';
import { NetworkConditioningService } from '../../../src/services/NetworkConditioningService';
import { InterceptorService } from '../../../src/services/InterceptorService';
import { PhoneNetworkRestore } from '../../../src/services/network/PhoneNetworkRestore';
import { PluginContext } from '../../../src/PluginContext';
import { DefaultPluginArgs } from '../../../src/interfaces/IPluginArgs';
import { XENON_CAPABILITIES } from '../../../src/XenonCapabilityManager';
import { SESSION_MANAGER } from '../../../src/sessions/SessionManager';
import SessionType from '../../../src/enums/SessionType';
import { saveRegistrations } from '../../helpers/container-registration';
import { useScratchDatabase } from '../../helpers/scratch-database';

const android = { udid: 'R5CT', platform: 'android', deviceType: 'real', host: 'h' } as any;

const sessionOf = (type: SessionType) =>
  ({
    getId: () => 's1',
    getType: () => type,
    getCapabilities: () => ({}),
    apiKeyId: null,
    userId: null,
    startVideoRecording: sinon.stub().resolves(),
  }) as any;

const capsWith = (extra: Record<string, unknown>) => ({
  [XENON_CAPABILITIES.VIDEO_RECORDING]: false,
  [XENON_CAPABILITIES.INTERCEPTOR_MOCKS]: [],
  [XENON_CAPABILITIES.INTERCEPTOR_INCLUDE_HOSTS]: [],
  [XENON_CAPABILITIES.INTERCEPTOR_EXCLUDE_HOSTS]: [],
  ...extra,
});

/**
 * Where a session's network changes are made. Only the server that drives the
 * phone makes them: a hub used to run its own adb against a node's phone (on
 * one Mac, the very same phone), and start a second proxy for it.
 */
describe('a session’s network changes at its start', function () {
  this.timeout(30_000);
  // The row a hub writes for a session another server runs (recordRoutedSession).
  const scratch = useScratchDatabase();
  let restoreRegs: () => void;
  let order: string[];
  let applyProfile: sinon.SinonStub;
  let start: sinon.SinonStub;
  let restoreLeftovers: sinon.SinonStub;
  let context: PluginContext;

  beforeEach(() => {
    restoreRegs = saveRegistrations(
      NetworkConditioningService,
      InterceptorService,
      PhoneNetworkRestore,
      PluginContext,
    );
    order = [];
    applyProfile = sinon.stub().callsFake(async () => void order.push('profile'));
    start = sinon.stub().callsFake(async () => void order.push('interceptor'));
    restoreLeftovers = sinon.stub().callsFake(async () => {
      order.push('leftovers');
      return 0;
    });
    Container.set(NetworkConditioningService, { applyProfile } as any);
    Container.set(InterceptorService, { start } as any);
    Container.set(PhoneNetworkRestore, { restoreLeftovers } as any);
    context = new PluginContext();
    context.pluginArgs = { ...DefaultPluginArgs, enableDashboard: false };
    Container.set(PluginContext, context);
  });

  afterEach(async () => {
    sinon.restore();
    SESSION_MANAGER.removeSession('s1');
    restoreRegs();
    await scratch.db.session.deleteMany({});
  });

  const apply = (type: SessionType, caps: Record<string, unknown>) =>
    (Container.get(SessionLifecycleService) as any).applyPostSessionLogic(
      sessionOf(type),
      caps,
      android,
    );

  it('puts back what an earlier session left on the phone, then applies its own', async () => {
    await apply(
      SessionType.LOCAL,
      capsWith({
        [XENON_CAPABILITIES.NETWORK_PROFILE]: 'Offline',
        [XENON_CAPABILITIES.INTERCEPTOR_ENABLED]: true,
      }),
    );

    expect(restoreLeftovers.calledOnceWith({ udid: 'R5CT' })).to.equal(true);
    expect(order).to.deep.equal(['leftovers', 'profile', 'interceptor']);
  });

  it("doesn't touch a phone another server drives", async () => {
    for (const type of [SessionType.REMOTE, SessionType.CLOUD]) {
      await apply(
        type,
        capsWith({
          [XENON_CAPABILITIES.NETWORK_PROFILE]: 'Offline',
          [XENON_CAPABILITIES.INTERCEPTOR_ENABLED]: true,
        }),
      );
      SESSION_MANAGER.removeSession('s1');
    }

    expect(order).to.deep.equal([]);
  });

  it("starts the interceptor by the server's option when the session doesn't say", async () => {
    context.pluginArgs = { ...context.pluginArgs, interceptor: { enabled: true, bufferSize: 9 } };

    await apply(SessionType.LOCAL, capsWith({}));

    expect(start.calledOnce).to.equal(true);
    const [sessionId, device, opts] = start.firstCall.args;
    expect(sessionId).to.equal('s1');
    expect(device).to.equal(android);
    expect(opts).to.include({ enabled: true, bufferSize: 9, captureBodies: true });
  });

  it("leaves the interceptor off when the session turns it off over the server's option", async () => {
    context.pluginArgs = { ...context.pluginArgs, interceptor: { enabled: true } };

    await apply(SessionType.LOCAL, capsWith({ [XENON_CAPABILITIES.INTERCEPTOR_ENABLED]: false }));

    expect(start.called).to.equal(false);
  });
});
