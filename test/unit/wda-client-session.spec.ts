import 'reflect-metadata';
import { expect } from 'chai';
import axios from 'axios';
import sinon from 'sinon';
import { Container } from 'typedi';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import { UnsupportedKeyError, WDAClient } from '../../src/device-managers/ios/WDAClient';
import { DeviceStoreFactory } from '../../src/data-service/device-store';

/**
 * Each live preview creates its own WebDriverAgent session, and WDAClient kept
 * the session it had seen first. After the preview restarted (device control
 * closed and opened again), every hardware button went to the old session:
 * WDA answered 404 "invalid session id", which pressButton and homescreen
 * treat as "not supported" rather than a dead session, so Home and the volume
 * buttons answered 500 until a lock or a swipe happened to renew it. A key
 * the iPhone does have was also reported as one it doesn't.
 */
describe('WDAClient follows the live preview’s WebDriverAgent session', () => {
  const PHONE = '00008110-00084CE80E51401E';
  const PORT = 28100;
  let urls: string[];
  // The session WebDriverAgent has now, and the one the preview recorded.
  let live: string;
  let previews: string | undefined;
  // Whether WDA names its live session when it refuses a dead one, as WDA does.
  let namesLiveSession: boolean;

  const deadSession = () =>
    Object.assign(new Error('Request failed with status code 404'), {
      response: {
        status: 404,
        data: {
          value: { error: 'invalid session id', message: 'Session does not exist' },
          sessionId: namesLiveSession ? live : null,
        },
      },
    });

  const unknownCommand = () =>
    Object.assign(new Error('Request failed with status code 404'), {
      response: {
        status: 404,
        data: { value: { error: 'unknown command' }, sessionId: live },
      },
    });

  beforeEach(() => {
    urls = [];
    namesLiveSession = true;
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async () => ({ udid: PHONE, realDevice: true }),
    } as any);
    const real = Container.get.bind(Container);
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === IOSStreamService) {
        return {
          getStreamStatus: () => ({ status: 'running', wdaPort: PORT }),
          getWDASessionId: () => previews,
          setWDASessionId: (_udid: string, sid: string | undefined) => {
            previews = sid || undefined;
          },
        };
      }
      return real(token);
    });
    sinon.stub(axios, 'post').callsFake((async (url: string) => {
      urls.push(url);
      const session = /\/session\/([^/]+)\//.exec(url)?.[1];
      if (session && session !== live) throw deadSession();
      // As WDA does: a button press needs a session, and the home screen
      // is reached only without one.
      if (!session && url.endsWith('/wda/pressButton')) throw unknownCommand();
      if (session && url.endsWith('/wda/homescreen')) throw unknownCommand();
      return { status: 200, data: { value: null, sessionId: live } };
    }) as any);
  });

  afterEach(() => sinon.restore());

  it('presses a button in the restarted preview’s session', async () => {
    const wda = new WDAClient();
    live = previews = 'FIRST';
    await wda.pressKey(PHONE, 'volumeup');

    // Device control closed and opened again: a new preview, a new session.
    live = previews = 'SECOND';
    urls = [];
    await wda.pressKey(PHONE, 'volumeup');

    expect(urls).to.deep.equal([`http://127.0.0.1:${PORT}/session/SECOND/wda/pressButton`]);
  });

  it('moves to the session WebDriverAgent names when the one it knew is gone', async () => {
    const wda = new WDAClient();
    live = previews = 'FIRST';
    await wda.pressKey(PHONE, 'home');

    // WDA started a new session that nothing here recorded.
    live = 'SECOND';
    urls = [];
    await wda.pressKey(PHONE, 'home');

    expect(urls[urls.length - 1]).to.equal(
      `http://127.0.0.1:${PORT}/session/SECOND/wda/pressButton`,
    );
    expect(previews).to.equal('SECOND');
  });

  it('does not call a dead session a key the iPhone lacks', async () => {
    live = 'SECOND';
    previews = 'FIRST';
    namesLiveSession = false;

    const err = await new WDAClient().pressKey(PHONE, 'camera').then(
      () => null,
      (e: Error) => e,
    );

    expect(err).to.be.an('error');
    expect(err).not.to.be.instanceOf(UnsupportedKeyError);
  });

  // Every caller sent it inside the session and got 404 "unknown command":
  // the Home key's fallback, the clipboard read, and putting the home screen
  // back after a clipboard write, which left WDA's black screen in front.
  it('goes to the home screen without a session, the only way WDA takes it', async () => {
    live = previews = 'FIRST';

    await new WDAClient().sendWDACommand(PHONE, 'post', '/wda/homescreen', {});

    expect(urls).to.deep.equal([`http://127.0.0.1:${PORT}/wda/homescreen`]);
  });
});
