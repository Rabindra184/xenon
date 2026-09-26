import { expect } from 'chai';
import sinon from 'sinon';
import { fillMissingScreenSize } from '../../src/services/fillMissingScreenSize';

describe('fillMissingScreenSize', () => {
  const device = (extra: any = {}) => ({
    udid: 'U1',
    host: 'http://h:4723',
    platform: 'android',
    ...extra,
  });

  const deps = (info: any = { screenWidth: '1080', screenHeight: '2220' }) => {
    const manager = { getAdditionalDeviceInfo: sinon.stub().resolves(info) };
    return {
      manager,
      managerFor: sinon.stub().resolves(manager),
      updateDevice: sinon.stub().resolves(),
    };
  };

  it('does nothing when the size is already known', async () => {
    const d = deps();
    const out = await fillMissingScreenSize(
      device({ screenWidth: '1080', screenHeight: '2220' }) as any,
      d,
    );
    expect(out).to.equal(false);
    expect(d.managerFor.called).to.equal(false);
  });

  // A reload restores tiles through stream/status, stream/ticket and the
  // H.264 socket, never stream/start. After a server restart the size was
  // therefore never fetched, and a tile without it has no tap layer at all.
  it('fetches and stores a missing size', async () => {
    const d = deps();
    expect(await fillMissingScreenSize(device() as any, d)).to.equal(true);
    expect(
      d.updateDevice.calledOnceWith('U1', 'http://h:4723', {
        screenWidth: '1080',
        screenHeight: '2220',
      }),
    ).to.equal(true);
  });

  it('shares one fetch between concurrent callers', async () => {
    const d = deps();
    await Promise.all([
      fillMissingScreenSize(device() as any, d),
      fillMissingScreenSize(device() as any, d),
      fillMissingScreenSize(device() as any, d),
    ]);
    expect(d.manager.getAdditionalDeviceInfo.callCount).to.equal(1);
  });

  it('never throws, so a caller can fire and forget', async () => {
    const d = deps();
    d.manager.getAdditionalDeviceInfo.rejects(new Error('adb gone'));
    expect(await fillMissingScreenSize(device() as any, d)).to.equal(false);
    expect(d.updateDevice.called).to.equal(false);
  });

  it('stores nothing when the platform cannot report a size', async () => {
    const d = deps({});
    expect(await fillMissingScreenSize(device() as any, d)).to.equal(false);
    expect(d.updateDevice.called).to.equal(false);
  });
});
