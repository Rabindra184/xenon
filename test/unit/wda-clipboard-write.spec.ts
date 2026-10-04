import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import { WDAClient } from '../../src/device-managers/ios/WDAClient';
import { DeviceStoreFactory } from '../../src/data-service/device-store';

/**
 * iOS ignores a pasteboard write from an app in the background, and
 * WebDriverAgent still answers success. Device control's "Write to device"
 * on an iPhone reported success and left the clipboard as it was (checked on
 * an iPhone 14 Plus, iOS 26.5). The write now brings WDA's own app forward,
 * reads the text back, and puts back the app that was in front.
 *
 * Bringing WDA's app forward waits for it to go idle, which it never does, so
 * the call took about 21 s. WDA's idle wait is turned off for that step and
 * put back after.
 */
describe('WDAClient writes an iPhone’s clipboard', () => {
  const PHONE = '00008110-00084CE80E51401E';
  const WDA = 'com.qasecret.WebDriverAgentRunner.xctrunner';
  const b64 = (s: string) => Buffer.from(s).toString('base64');

  // The phone as iOS behaves: only the app in front can write the pasteboard.
  let phone: {
    front: string;
    pasteboard: string;
    idleWait: number;
    takesWrites: boolean;
    realDevice: boolean;
  };
  let calls: string[];
  let idleWaitAtActivation: number[];
  let unreadableSettings: boolean;

  beforeEach(() => {
    idleWaitAtActivation = [];
    unreadableSettings = false;
    phone = {
      front: 'com.apple.springboard',
      pasteboard: '',
      idleWait: 10,
      takesWrites: true,
      realDevice: true,
    };
    calls = [];
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async () => ({ udid: PHONE, realDevice: phone.realDevice }),
    } as any);
    const real = Container.get.bind(Container);
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === IOSStreamService) return { detectWDABundleId: async () => WDA };
      return real(token);
    });
    sinon.stub(WDAClient.prototype, 'sendWDACommand').callsFake((async (
      _udid: string,
      method: string,
      endpoint: string,
      data?: any,
    ) => {
      calls.push(`${method} ${endpoint}`);
      const ok = (value: any = null) => ({ status: 200, data: { value } });
      switch (`${method} ${endpoint}`) {
        case 'get /wda/activeAppInfo':
          return ok({ bundleId: phone.front });
        case 'get /appium/settings':
          if (unreadableSettings) throw new Error('WDA request failed: /appium/settings');
          return ok({ waitForIdleTimeout: phone.idleWait });
        case 'post /appium/settings':
          phone.idleWait = data.settings.waitForIdleTimeout;
          return ok();
        case 'post /wda/apps/activate':
          if (data.bundleId === WDA) idleWaitAtActivation.push(phone.idleWait);
          phone.front = data.bundleId;
          return ok();
        case 'post /wda/homescreen':
          phone.front = 'com.apple.springboard';
          return ok();
        case 'post /wda/setPasteboard':
          if (phone.front === WDA && phone.takesWrites) {
            phone.pasteboard = Buffer.from(data.content, 'base64').toString();
          }
          return ok(); // success either way, as WDA answers
        case 'post /wda/getPasteboard':
          return ok(phone.front === WDA ? b64(phone.pasteboard) : '');
        default:
          throw new Error(`unexpected ${method} ${endpoint}`);
      }
    }) as any);
  });

  afterEach(() => sinon.restore());

  it('writes the clipboard while WebDriverAgent is in the background', async () => {
    await new WDAClient().setClipboard(PHONE, 'hello from Xenon');

    expect(phone.pasteboard).to.equal('hello from Xenon');
  });

  it('puts the home screen back when that was in front', async () => {
    await new WDAClient().setClipboard(PHONE, 'x');

    expect(phone.front).to.equal('com.apple.springboard');
  });

  it('puts back the app that was in front', async () => {
    phone.front = 'com.apple.Preferences';

    await new WDAClient().setClipboard(PHONE, 'x');

    expect(phone.front).to.equal('com.apple.Preferences');
  });

  it('brings WebDriverAgent forward without its idle wait, and restores the wait', async () => {
    phone.idleWait = 7;

    await new WDAClient().setClipboard(PHONE, 'x');

    expect(idleWaitAtActivation).to.deep.equal([0]);
    expect(phone.idleWait).to.equal(7);
  });

  it('fails when the iPhone did not take the text', async () => {
    phone.takesWrites = false;

    const err = await new WDAClient().setClipboard(PHONE, 'lost').then(
      () => null,
      (e: Error) => e,
    );

    expect(err?.message).to.equal('The iPhone didn’t take the clipboard text.');
    expect(phone.front).to.equal('com.apple.springboard');
    expect(phone.idleWait).to.equal(10);
  });

  it('writes a simulator’s clipboard directly', async () => {
    phone.realDevice = false;
    phone.front = WDA; // a simulator's pasteboard takes the write from anywhere

    await new WDAClient().setClipboard(PHONE, 'sim');

    expect(calls).to.deep.equal(['post /wda/setPasteboard']);
  });

  it('leaves the idle wait alone when it can’t read it, since it couldn’t put it back', async () => {
    unreadableSettings = true;

    await new WDAClient().setClipboard(PHONE, 'slow but safe');

    expect(idleWaitAtActivation).to.deep.equal([10]);
    expect(calls).not.to.include('post /appium/settings');
    expect(phone.pasteboard).to.equal('slow but safe');
  });
});
