import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { XenonPlugin } from '../../src/plugin';
import NodeDevices from '../../src/device-managers/NodeDevices';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * A session's sampling stops however the session ends on this server, its
 * dashboard on or off: on a node that ends the figures it holds for the hub.
 */
describe('session sampling stops however a session ends', function () {
  this.timeout(30_000);
  useScratchDatabase();
  let restore: () => void;
  let stop: sinon.SinonStub;

  beforeEach(() => {
    restore = saveRegistrations(SessionMetricsService);
    stop = sinon.stub().resolves();
    Container.set(SessionMetricsService, { stop } as any);
  });
  afterEach(() => {
    sinon.restore();
    restore();
  });

  it('at shutdown', async () => {
    sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').resolves();
    await Container.get(SessionLifecycleService).stopSessionForShutdown('s-down', 'shutdown');
    expect(stop.calledWith('s-down')).to.equal(true);
  });

  it('when the driver shuts down unexpectedly on a node', async () => {
    sinon.stub(NodeDevices.prototype, 'unblockDevice').resolves();
    const plugin = { pluginArgs: { hub: 'http://hub:4723' } };
    await XenonPlugin.prototype.onUnexpectedShutdown.call(
      plugin as any,
      { sessionId: 's-crash', caps: {} },
      null,
    );
    expect(stop.calledWith('s-crash')).to.equal(true);
  });
});
