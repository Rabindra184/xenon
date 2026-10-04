import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { ServerManager } from '../../../src/services/ServerManager';
import { PhoneNetworkRestore } from '../../../src/services/network/PhoneNetworkRestore';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import { saveRegistrations } from '../../helpers/container-registration';

const ME = 'http://10.0.0.5:4723';
const NODE_ID = 'node-me';

/**
 * At its start a server checks the network of the Android phones it drives:
 * never a phone another server on the same machine drives (a hub keeps its
 * nodes' rows), a cloud phone or an iPhone.
 */
describe('the phone network check at boot', () => {
  let restoreRegs: () => void;
  let cleanUpAtBoot: sinon.SinonStub;

  beforeEach(() => {
    restoreRegs = saveRegistrations(PhoneNetworkRestore);
    cleanUpAtBoot = sinon.stub().resolves();
    Container.set(PhoneNetworkRestore, { cleanUpAtBoot } as any);
  });

  afterEach(() => {
    sinon.restore();
    restoreRegs();
  });

  it("checks this server's own Android phones, once each", async () => {
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      getAllDevices: async () => [
        { udid: 'MINE', platform: 'android', host: ME, nodeId: NODE_ID },
        { udid: 'MINE', platform: 'android', host: ME, nodeId: NODE_ID },
        { udid: 'NO-ID', platform: 'android', host: ME },
        { udid: 'NODE', platform: 'android', host: 'http://10.0.0.5:4724', nodeId: 'node-b' },
        { udid: 'CLOUD', platform: 'android', host: ME, nodeId: NODE_ID, cloud: { name: 'x' } },
        { udid: 'IPHONE', platform: 'ios', host: ME, nodeId: NODE_ID },
      ],
    } as any);

    await (Container.get(ServerManager) as any).cleanUpPhoneNetworks(
      { origin: ME, hosts: new Set([ME]) },
      NODE_ID,
    );

    expect(cleanUpAtBoot.calledOnce).to.equal(true);
    expect(cleanUpAtBoot.firstCall.args[0]).to.deep.equal(['MINE', 'NO-ID']);
  });

  it('never fails the boot', async () => {
    sinon.stub(DeviceStoreFactory, 'getStore').throws(new Error('no store'));
    await (Container.get(ServerManager) as any).cleanUpPhoneNetworks(
      { origin: ME, hosts: new Set([ME]) },
      NODE_ID,
    );
    expect(cleanUpAtBoot.called).to.equal(false);
  });
});
