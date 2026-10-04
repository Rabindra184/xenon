import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { UnsupportedKeyError, WDAClient } from '../../src/device-managers/ios/WDAClient';

/**
 * Device control on an iPhone answered 200 for a clipboard write, a lock or
 * an unlock that WebDriverAgent refused: WDAClient caught the error and only
 * logged it at debug level. A key the phone doesn't have was also "pressed"
 * successfully. The failures now reach the caller.
 */
describe('WDAClient reports what WebDriverAgent refused', () => {
  const PHONE = '00008110-00084CE80E51401E';
  let send: sinon.SinonStub;

  beforeEach(() => {
    send = sinon.stub(WDAClient.prototype, 'sendWDACommand');
  });
  afterEach(() => sinon.restore());

  // WDA answered and refused: axios puts its answer on `response`.
  const refuse = (path: string) =>
    send.withArgs(PHONE, 'post', path).rejects(
      Object.assign(new Error(`WDA request failed: ${path} 500`), {
        response: { status: 500, data: { value: { error: 'unknown error' } } },
      }),
    );

  for (const [name, path, call] of [
    ['setClipboard', '/wda/setPasteboard', (c: WDAClient) => c.setClipboard(PHONE, 'hello')],
    ['lock', '/wda/lock', (c: WDAClient) => c.lock(PHONE)],
    ['unlock', '/wda/unlock', (c: WDAClient) => c.unlock(PHONE)],
  ] as const) {
    it(`${name} fails when WebDriverAgent refuses`, async () => {
      refuse(path);
      const err = await call(new WDAClient()).then(
        () => null,
        (e: Error) => e,
      );
      expect(err?.message).to.include(path);
    });

    it(`${name} succeeds when WebDriverAgent accepts`, async () => {
      send.resolves({});
      await call(new WDAClient());
    });
  }

  it('pressKey refuses a key the iPhone does not have', async () => {
    refuse('/wda/pressButton');
    const err = await new WDAClient().pressKey(PHONE, 'F13').then(
      () => null,
      (e: Error) => e,
    );
    expect(err).to.be.instanceOf(UnsupportedKeyError);
    expect(err?.message).to.equal('The key "F13" isn\'t available on an iPhone.');
  });

  it('pressKey reports WebDriverAgent being unreachable, not an unsupported key', async () => {
    send
      .withArgs(PHONE, 'post', '/wda/pressButton')
      .rejects(
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8100'), { code: 'ECONNREFUSED' }),
      );
    const err = await new WDAClient().pressKey(PHONE, 'f13').then(
      () => null,
      (e: Error) => e,
    );
    expect(err).not.to.be.instanceOf(UnsupportedKeyError);
    expect(err?.message).to.include('ECONNREFUSED');
  });

  it('pressKey fails when a hardware button and its fallback both fail', async () => {
    refuse('/wda/pressButton');
    refuse('/wda/homescreen');
    const err = await new WDAClient().pressKey(PHONE, 'home').then(
      () => null,
      (e: Error) => e,
    );
    expect(err).to.be.an('error');
    expect(err).not.to.be.instanceOf(UnsupportedKeyError);
  });

  it('pressKey still falls back to the home screen on an old WebDriverAgent', async () => {
    refuse('/wda/pressButton');
    send.withArgs(PHONE, 'post', '/wda/homescreen').resolves({});
    await new WDAClient().pressKey(PHONE, 'home');
  });

  it('pressKey fails a keyboard key only when both ways of typing it fail', async () => {
    refuse('/wda/keys');
    send.withArgs(PHONE, 'post', '/wda/type').resolves({});
    await new WDAClient().pressKey(PHONE, 'enter');

    send.withArgs(PHONE, 'post', '/wda/type').rejects(new Error('WDA request failed: /wda/type'));
    const err = await new WDAClient().pressKey(PHONE, 'enter').then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).to.include('/wda/type');
  });

  it('pressKey fails a volume button WebDriverAgent refuses', async () => {
    refuse('/wda/pressButton');
    const err = await new WDAClient().pressKey(PHONE, 'volume_up').then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).to.include('/wda/pressButton');
  });
});
