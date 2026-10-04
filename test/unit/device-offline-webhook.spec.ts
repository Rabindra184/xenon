import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { addNewDevice, removeDevice } from '../../src/data-service/device-service';
import { NotificationService } from '../../src/services/NotificationService';
import { SocketServer } from '../../src/services/SocketServer';
import { IDevice } from '../../src/interfaces/IDevice';
import { saveRegistrations } from '../helpers/container-registration';
import { useLokiStores } from '../helpers/loki-stores';

/**
 * The `device_offline` webhook carries the device's name and platform, as its
 * documented payload says (src/services/webhookEvents.ts). Every caller of
 * `removeDevice` holds only a udid and a host, so the event used to carry just
 * those two and `{{name}}` stayed unfilled in a template.
 */
describe('device_offline: what the event carries', () => {
  useLokiStores();
  let restore: () => void;
  let dispatch: sinon.SinonStub;
  const HOST = 'http://127.0.0.1:4723';

  beforeEach(() => {
    restore = saveRegistrations(NotificationService, SocketServer);
    dispatch = sinon.stub().resolves();
    Container.set({ id: NotificationService, value: { dispatchEvent: dispatch } });
    Container.set({
      id: SocketServer,
      value: {
        emitToDashboard: () => undefined,
        emitToDashboardForDevices: async () => undefined,
        hasScopedDashboard: () => false,
      },
    });
  });

  afterEach(() => {
    sinon.restore();
    restore();
  });

  const phone = () =>
    ({
      udid: 'R58M123',
      name: 'Galaxy S9+',
      platform: 'android',
      sdk: '10',
      host: HOST,
      busy: false,
      offline: false,
      userBlocked: false,
      deviceType: 'real',
      realDevice: true,
    }) as unknown as IDevice;

  it('names the device and its platform, though the caller passed only a udid and a host', async () => {
    await addNewDevice([phone()]);
    dispatch.resetHistory();

    await removeDevice([{ udid: 'R58M123', host: HOST }]);

    expect(dispatch.calledOnce).to.equal(true);
    expect(dispatch.firstCall.args[0]).to.equal('device_offline');
    expect(dispatch.firstCall.args[1]).to.include({
      udid: 'R58M123',
      host: HOST,
      name: 'Galaxy S9+',
      platform: 'android',
    });
  });

  it('still reports a device the store no longer knows, by its udid and host', async () => {
    await removeDevice([{ udid: 'gone-1', host: HOST }]);

    expect(dispatch.firstCall.args[1]).to.deep.include({ udid: 'gone-1', host: HOST });
  });
});
