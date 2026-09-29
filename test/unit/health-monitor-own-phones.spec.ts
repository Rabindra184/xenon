import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { HealthMonitorService } from '../../src/device-managers/HealthMonitorService';
import { XenonManager } from '../../src/device-managers';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * A hub keeps its nodes' phones in its own Device table. Its health monitor
 * ran adb (or go-ios) health checks on every row, so it checked node phones it
 * cannot reach from its own machine: each came back unhealthy, the hub wrote
 * that over the node's report, started a "recovery" with its own adb, and
 * reclaimed a busy node phone whose session it didn't hold in memory. Only
 * this server's own phones are checked (isOwnDevice: by nodeId, else by exact
 * host).
 */

// Named like the real manager: the monitor picks one by constructor.name.
class AndroidDeviceManager {
  checked: string[] = [];
  checkHealth = async (device: { udid: string }) => {
    this.checked.push(device.udid);
    return { healthStatus: 'Healthy' };
  };
}

describe('HealthMonitorService checks only this server’s own phones', () => {
  const HUB_NODE_ID = 'hub-node-id';
  const HUB_HOST = 'http://10.0.0.1:4799';
  let manager: AndroidDeviceManager;
  let updateDevice: sinon.SinonSpy;
  let context: PluginContext;
  let saved: Partial<PluginContext>;
  let restore: () => void;

  const devices = [
    // Found by this hub's own discovery.
    { udid: 'hub-phone', host: HUB_HOST, nodeId: HUB_NODE_ID },
    // A node's, reported over /register with the node's id.
    { udid: 'node-phone', host: 'http://10.0.0.2:4725', nodeId: 'node-peer' },
    // A node's on the same machine, differing only by port.
    { udid: 'same-machine-node-phone', host: 'http://10.0.0.1:4725', nodeId: 'node-2' },
    // A node's busy phone, its session not in this hub's memory.
    {
      udid: 'busy-node-phone',
      host: 'http://10.0.0.2:4725',
      nodeId: 'node-peer',
      busy: true,
      session_id: 'node-session',
    },
    // A row from before nodeId, known by its host alone.
    { udid: 'legacy-hub-phone', host: HUB_HOST, nodeId: null },
    { udid: 'legacy-node-phone', host: 'http://10.0.0.3:4725', nodeId: null },
  ].map((d) => ({ platform: 'android', busy: false, cloud: null, ...d }));

  beforeEach(() => {
    sinon.stub(process, 'kill');
    manager = new AndroidDeviceManager();
    restore = saveRegistrations(XenonManager);
    Container.set(XenonManager, { deviceInstances: async () => [manager] } as any);
    updateDevice = sinon.spy(async () => undefined);
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      getAllDevices: async () => devices,
      updateDevice,
    } as any);
    sinon.stub(SESSION_MANAGER, 'isValidSession').returns(false);
    context = Container.get(PluginContext);
    saved = { ...context };
    context.setContext(
      { ...DefaultPluginArgs, bindHostOrIp: '10.0.0.1' } as any,
      4799,
      HUB_NODE_ID,
      '',
    );
  });

  afterEach(() => {
    Object.assign(context, saved);
    sinon.restore();
    restore();
  });

  const run = () => (new HealthMonitorService({} as any) as any).checkAllDevices();

  it('checks the hub’s own phones and none of its nodes’', async () => {
    await run();
    expect(manager.checked.sort()).to.deep.equal(['hub-phone', 'legacy-hub-phone']);
  });

  it('never writes to a node’s phone, nor reclaims a busy one', async () => {
    await run();
    const written = updateDevice.getCalls().map((c) => c.args[0]);
    expect(written.sort()).to.deep.equal(['hub-phone', 'legacy-hub-phone']);
  });
});
