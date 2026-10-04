import 'reflect-metadata';
import { expect } from 'chai';
import net from 'net';
import {
  isPortListening,
  isUnsetProxy,
  parseProxySetting,
  pointsAtThisMachine,
} from '../../../src/services/network/xenonProxy';

describe('a phone proxy setting, read', () => {
  it('parses host:port', () => {
    expect(parseProxySetting('127.0.0.1:11100')).to.deep.equal({ host: '127.0.0.1', port: 11100 });
    expect(parseProxySetting(' 10.0.2.2:11105 ')).to.deep.equal({ host: '10.0.2.2', port: 11105 });
  });

  it('reads no proxy from what Android stores for none', () => {
    for (const none of [null, undefined, '', 'null', ':0', '  ']) {
      expect(isUnsetProxy(none), String(none)).to.equal(true);
      expect(parseProxySetting(none)).to.equal(null);
    }
    expect(isUnsetProxy('proxy.corp:3128')).to.equal(false);
  });

  it('refuses a value that is not host:port', () => {
    expect(parseProxySetting('proxy.corp')).to.equal(null);
    expect(parseProxySetting('a:b')).to.equal(null);
    expect(parseProxySetting('a:0')).to.equal(null);
    expect(parseProxySetting('a:70000')).to.equal(null);
  });

  it('knows the addresses a phone uses to reach this machine', () => {
    const own = ['192.168.1.20'];
    expect(pointsAtThisMachine('127.0.0.1', own)).to.equal(true);
    expect(pointsAtThisMachine('localhost', own)).to.equal(true);
    expect(pointsAtThisMachine('10.0.2.2', own)).to.equal(true);
    expect(pointsAtThisMachine('192.168.1.20', own)).to.equal(true);
    expect(pointsAtThisMachine('192.168.1.21', own)).to.equal(false);
    expect(pointsAtThisMachine('proxy.corp', own)).to.equal(false);
  });
});

describe('isPortListening', function () {
  let server: net.Server;
  let livePort: number;
  let deadPort: number;

  before(async () => {
    server = net.createServer((s) => s.destroy());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    livePort = (server.address() as net.AddressInfo).port;
    const closed = net.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r()));
    deadPort = (closed.address() as net.AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
  });
  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('says a port with a listener answers', async () => {
    expect(await isPortListening(livePort)).to.equal(true);
  });

  it('says a closed port does not', async () => {
    expect(await isPortListening(deadPort)).to.equal(false);
  });
});
