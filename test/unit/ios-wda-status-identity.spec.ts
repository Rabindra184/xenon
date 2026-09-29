import 'reflect-metadata';
import { expect } from 'chai';
import http from 'http';
import { AddressInfo } from 'net';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';

/**
 * isWDARunning took a udid and compared it with `value.ios.udid` from WDA's
 * /status, which WDA never sends. The check could never refuse anything.
 *
 * What WDA does send (WebDriverAgent, FBSessionCommands.m handleGetStatus):
 * ready, message, state, os {name, version, sdkVersion,
 * testmanagerdVersion}, ios {ip} (plus simulatorVersion on a simulator),
 * build and device (the form factor). /wda/device/info
 * (FBCustomCommands.m) has a `uuid`, but that is identifierForVendor, not
 * the phone's UDID. No endpoint names the phone.
 *
 * The fake WDA below listens on an OS-assigned port on 127.0.0.1.
 */

const REAL_WDA_STATUS = {
  value: {
    ready: true,
    message: 'WebDriverAgent is ready to accept commands',
    state: 'success',
    os: { name: 'iOS', version: '26.7', sdkVersion: '26.0', testmanagerdVersion: 65535 },
    ios: { ip: '192.168.0.23' },
    build: {
      time: 'Jul 14 2026 08:53:17',
      productBundleIdentifier: 'com.facebook.WebDriverAgentRunner',
      version: '11.4.1',
    },
    device: 'iphone',
  },
  sessionId: null,
};

describe('isWDARunning: WDA names no device', () => {
  let server: http.Server;
  let port: number;
  let requests: number;
  let answers: number[];

  beforeEach(async () => {
    requests = 0;
    answers = [];
    server = http.createServer((req, res) => {
      requests++;
      const status = answers.shift() ?? 200;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? REAL_WDA_STATUS : { value: { error: 'busy' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function service(): any {
    // Bypass the constructor: it starts watchdog intervals.
    return Object.create(IOSStreamService.prototype);
  }

  it("answers ready from WDA's real /status, which carries no udid", async () => {
    expect(await service().isWDARunning(port)).to.equal(true);
    expect(JSON.stringify(REAL_WDA_STATUS)).to.not.match(/udid/i);
  });

  it('takes the retry budget as its second argument: 0 means one attempt', async () => {
    // A transient 5xx is retried; with no retries asked for it is the answer.
    answers = [503, 200];

    const up = await service().isWDARunning(port, 0);

    expect(requests, 'one attempt').to.equal(1);
    expect(up).to.equal(false);
  });
});
