import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { Container } from 'typedi';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import { IOSTunnels } from '../../src/device-managers/ios/IOSTunnels';
import { WDAClient } from '../../src/device-managers/ios/WDAClient';
import { DeviceStoreFactory } from '../../src/data-service/device-store';

/**
 * The Shell tab on iOS: simctl commands and a few generic ones on simulators,
 * go-ios commands on real iPhones. Through 2.13.2 a real iPhone's command could
 * carry its own `--udid` (another phone on the Mac), `list` named every device
 * attached to the Mac, simulator commands took any path on this Mac, and the
 * go-ios call ran without the phone's tunnel, so iOS 17+ phones never answered.
 *
 * `xcrun` and `ios` here are scripts that print the arguments they were given.
 */

const SIMULATOR = 'TEST-SIM-0000-AAAA';
const IPHONE = '00008110-00084CE80E51401E';

const ECHO = `#!/bin/sh
printf '%s|' "$@"
printf 'port=%s' "$GO_IOS_AGENT_PORT"
`;

describe('WDAClient.executeShell', () => {
  let dir: string;
  let savedPath: string | undefined;
  let realDevice: boolean;
  const borrowed: string[] = [];

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-fake-shell-'));
    fs.writeFileSync(path.join(dir, 'xcrun'), ECHO, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'ios'), ECHO, { mode: 0o755 });
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  beforeEach(() => {
    savedPath = process.env.PATH;
    process.env.PATH = `${dir}:${process.env.PATH}`;
    borrowed.length = 0;
    const stream = { isGoIOSAvailable: async () => true, goIOSPath: path.join(dir, 'ios') };
    const tunnels = {
      async borrow(udid: string) {
        borrowed.push(udid);
        return 12100;
      },
      envFor: () => ({ ...process.env, GO_IOS_AGENT_PORT: '12100' }),
    };
    const real = Container.get.bind(Container);
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === IOSStreamService) return stream;
      if (token === IOSTunnels) return tunnels;
      return real(token);
    });
    sinon
      .stub(DeviceStoreFactory, 'getStore')
      .returns({ findDevice: async () => ({ realDevice }) } as any);
  });

  afterEach(() => {
    process.env.PATH = savedPath;
    sinon.restore();
  });

  const run = (udid: string, command: string) =>
    new WDAClient().executeShell(udid, command).then(
      (out) => ({ out }),
      (err: Error) => ({ err: err.message }),
    );

  describe('on a simulator', () => {
    beforeEach(() => {
      realDevice = false;
    });

    it('runs a simctl command for this simulator', async () => {
      const { out } = (await run(SIMULATOR, 'getenv HOME')) as { out: string };
      expect(out).to.match(new RegExp(`^simctl\\|getenv\\|${SIMULATOR}\\|HOME\\|`));
    });

    it('spawns a generic command in this simulator, without arguments', async () => {
      const { out } = (await run(SIMULATOR, 'ls')) as { out: string };
      expect(out).to.match(new RegExp(`^simctl\\|spawn\\|${SIMULATOR}\\|ls\\|`));
      expect(await run(SIMULATOR, 'ls /Users'))
        .to.have.property('err')
        .that.match(/not allowed/);
    });

    it('refuses list, chaining and look-alikes', async () => {
      for (const cmd of ['list', 'ls; id', 'lsof', 'getenv $HOME']) {
        expect(await run(SIMULATOR, cmd), cmd)
          .to.have.property('err')
          .that.match(/not allowed/);
      }
    });
  });

  describe('on a real iPhone', () => {
    beforeEach(() => {
      realDevice = true;
    });

    it('runs a go-ios command for this phone, through its tunnel', async () => {
      const { out } = (await run(IPHONE, 'apps --list')) as { out: string };
      expect(out).to.equal(`apps|--list|--udid|${IPHONE}|port=12100`);
      expect(borrowed).to.deep.equal([IPHONE]);
    });

    it('refuses a command that names another device, and list', async () => {
      for (const cmd of [
        'apps --udid 00008101-OTHER',
        'apps --udid=00008101-OTHER',
        'list',
        'info --json',
      ]) {
        expect(await run(IPHONE, cmd), cmd)
          .to.have.property('err')
          .that.match(/not allowed/);
      }
    });

    it('says a generic command needs a simulator', async () => {
      expect(await run(IPHONE, 'ls'))
        .to.have.property('err')
        .that.match(/real/i);
    });
  });
});
