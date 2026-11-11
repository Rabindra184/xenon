import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import {
  NetworkConditioningService,
  ProfileOutcome,
} from '../../../src/services/NetworkConditioningService';
import { PhoneNetworkLedger } from '../../../src/services/network/PhoneNetworkLedger';
import { PhoneNetworkRestore } from '../../../src/services/network/PhoneNetworkRestore';
import {
  EmulatorConsole,
  EmulatorShape,
  UNSHAPED,
  emulatorConsolePort,
  shapeCommands,
} from '../../../src/services/network/EmulatorConsole';
import { CommandInterceptor } from '../../../src/interceptors/CommandInterceptor';
import * as DeviceService from '../../../src/data-service/device-service';
import * as OwnDeviceRow from '../../../src/device-managers/ownDeviceRow';
import { IDevice } from '../../../src/interfaces/IDevice';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { FakeAdb, fakeAdb, useFakeAdb } from '../../helpers/fake-adb';
import { saveRegistrations } from '../../helpers/container-registration';

const RADIOS_ON = {
  'shell settings get global wifi_on': '1',
  'shell settings get global mobile_data': '1',
};

const emulator = (udid = 'emulator-5554', extra: Partial<IDevice> = {}): IDevice =>
  ({
    udid,
    platform: 'android',
    realDevice: false,
    host: 'http://127.0.0.1:4723',
    ...extra,
  }) as any;
const realPhone = (udid = 'R5CT'): IDevice =>
  ({ udid, platform: 'android', realDevice: true, host: 'http://127.0.0.1:4723' }) as any;

/** A stand-in for an emulator console: what Xenon asked of it, and its shape. */
function fakeConsole(initial: EmulatorShape = UNSHAPED, fail?: Error) {
  const calls: string[] = [];
  let shape = { ...initial };
  const console = {
    readShape: async () => {
      calls.push('read');
      if (fail) throw fail;
      return { ...shape };
    },
    applyShape: async (next: EmulatorShape) => {
      calls.push(`apply ${shapeCommands(next).join(' / ')}`);
      if (fail) throw fail;
      shape = { ...next };
    },
  };
  return { console: console as unknown as EmulatorConsole, calls, now: () => shape };
}

/**
 * ENH-20: a session's network profile changes during the session
 * (`xenon: setNetworkProfile`), and on an Android emulator 4G, 3G and Edge
 * shape the app's own traffic through the emulator's console. Whatever a
 * session changed is put back when it ends, and after a crash.
 */
describe('Network profiles during a session (ENH-20)', function () {
  this.timeout(60_000);

  describe('emulatorConsolePort', () => {
    it("is an emulator's serial port, for an emulator this server drives", () => {
      expect(emulatorConsolePort(emulator('emulator-5556'))).to.equal(5556);
    });
    it("is none for a real phone, an iPhone, a remote adb server's emulator, or another serial", () => {
      expect(emulatorConsolePort(realPhone())).to.equal(undefined);
      expect(
        emulatorConsolePort({ udid: 'emulator-5554', platform: 'ios', realDevice: false }),
      ).to.equal(undefined);
      expect(
        emulatorConsolePort(emulator('emulator-5554', { adbRemoteHost: '10.0.0.9' } as any)),
      ).to.equal(undefined);
      expect(emulatorConsolePort(emulator('192.168.1.5:5555'))).to.equal(undefined);
    });
  });

  describe('EmulatorConsole, against a console speaking its protocol', () => {
    let server: net.Server;
    let port: number;
    let received: string[];
    let state: { up: number; down: number; min: number; max: number };
    let token: string | undefined;
    let dir: string;

    beforeEach(async () => {
      received = [];
      state = { up: 0, down: 0, min: 0, max: 0 };
      token = undefined;
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-console-'));
      server = net.createServer((socket) => {
        let authed = !token;
        socket.write("Android Console: type 'help' for a list of commands\r\n");
        if (token) socket.write('Android Console: Authentication required\r\n');
        socket.write('OK\r\n');
        let buf = '';
        socket.on('data', (chunk) => {
          buf += chunk.toString();
          let nl: number;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).replace(/\r$/, '');
            buf = buf.slice(nl + 1);
            received.push(line);
            if (line === 'quit') return socket.end();
            if (line.startsWith('auth ')) {
              authed = line.slice(5) === token;
              socket.write(authed ? 'OK\r\n' : 'KO: authentication token does not match\r\n');
            } else if (!authed) {
              socket.write("KO: unknown command, try 'help'\r\n");
            } else if (line === 'network status') {
              socket.write(
                `Current network status:\r\n  download speed:   ${state.down * 1000} bits/s (x KB/s)\r\n` +
                  `  upload speed:     ${state.up * 1000} bits/s (x KB/s)\r\n` +
                  `  minimum latency:  ${state.min} ms\r\n  maximum latency:  ${state.max} ms\r\nOK\r\n`,
              );
            } else if (line.startsWith('network speed ')) {
              const v = line.slice(14);
              [state.up, state.down] = v === 'full' ? [0, 0] : v.split(':').map(Number);
              socket.write('OK\r\n');
            } else if (line.startsWith('network delay ')) {
              const v = line.slice(14);
              [state.min, state.max] = v === 'none' ? [0, 0] : v.split(':').map(Number);
              socket.write('OK\r\n');
            } else {
              socket.write("KO: unknown command, try 'help'\r\n");
            }
          }
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      port = (server.address() as net.AddressInfo).port;
    });

    afterEach(async () => {
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const tokenFile = (value: string | null) => {
      const file = path.join(dir, 'token');
      if (value !== null) fs.writeFileSync(file, value);
      return file;
    };

    it('reads the shape from network status', async () => {
      state = { up: 1000, down: 2000, min: 100, max: 100 };
      const shape = await new EmulatorConsole(port, { tokenFile: tokenFile(null) }).readShape();
      expect(shape).to.deep.equal({
        upKbps: 1000,
        downKbps: 2000,
        minLatencyMs: 100,
        maxLatencyMs: 100,
      });
    });

    it('sets speed up:down and delay min:max, and full / none for no limit', async () => {
      const c = new EmulatorConsole(port, { tokenFile: tokenFile(null) });
      await c.applyShape({ upKbps: 150, downKbps: 250, minLatencyMs: 400, maxLatencyMs: 400 });
      expect(state).to.deep.equal({ up: 150, down: 250, min: 400, max: 400 });
      await c.applyShape(UNSHAPED);
      expect(state).to.deep.equal({ up: 0, down: 0, min: 0, max: 0 });
      expect(received).to.include.members(['network speed full', 'network delay none']);
    });

    it('signs in with the token file when there is one, and not when it is empty', async () => {
      token = 's3cret';
      await new EmulatorConsole(port, { tokenFile: tokenFile('s3cret\n') }).readShape();
      expect(received[0]).to.equal('auth s3cret');
      received = [];
      token = undefined;
      await new EmulatorConsole(port, { tokenFile: tokenFile('') }).readShape();
      // The first conversation's closing `quit` may land after the reset.
      const sent = received.filter((line) => line !== 'quit');
      expect(sent).to.deep.equal(['network status']);
    });

    it('fails on a refused command, a wrong token, no console, or no answer', async () => {
      const fails = async (p: Promise<unknown>) => {
        let e: any;
        await p.catch((x) => (e = x));
        return String(e?.message ?? 'no error');
      };
      expect(
        await fails(new EmulatorConsole(port, { tokenFile: tokenFile(null) }).run(['bogus'])),
      ).to.match(/refused a command: unknown command/);
      token = 'right';
      expect(
        await fails(new EmulatorConsole(port, { tokenFile: tokenFile('wrong') }).readShape()),
      ).to.match(/authentication token does not match/);
      const closed = await new Promise<number>((r) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => {
          const p = (s.address() as net.AddressInfo).port;
          s.close(() => r(p));
        });
      });
      expect(
        await fails(new EmulatorConsole(closed, { tokenFile: tokenFile(null) }).readShape()),
      ).to.match(/no emulator console on port/);
      const silent = net.createServer(() => undefined);
      await new Promise<void>((r) => silent.listen(0, '127.0.0.1', () => r()));
      const sp = (silent.address() as net.AddressInfo).port;
      expect(
        await fails(
          new EmulatorConsole(sp, { tokenFile: tokenFile(null), timeoutMs: 200 }).readShape(),
        ),
      ).to.match(/didn't answer in time/);
      silent.close();
    });
  });

  describe('NetworkConditioningService', () => {
    useScratchDatabase();
    let adb: FakeAdb;
    useFakeAdb(() => adb);
    let ledger: PhoneNetworkLedger;

    beforeEach(async () => {
      adb = fakeAdb({ ...RADIOS_ON });
      ledger = new PhoneNetworkLedger();
      for (const entry of await ledger.list()) await ledger.forget(entry.sessionId);
    });
    afterEach(() => sinon.restore());

    const service = (c: ReturnType<typeof fakeConsole>) => {
      const svc = new NetworkConditioningService();
      svc.consoleFor = () => c.console;
      return svc;
    };

    it("shapes an emulator's traffic for 3G, writing its shape down first", async () => {
      const c = fakeConsole({ upKbps: 0, downKbps: 0, minLatencyMs: 5, maxLatencyMs: 5 });
      const svc = service(c);
      const note = sinon.spy(PhoneNetworkLedger.prototype, 'note');
      const outcome = await svc.setProfile('s1', emulator(), '3G');

      expect(outcome).to.deep.equal({ profile: '3G', appTraffic: 'shaped', commandDelayMs: 100 });
      expect(c.calls).to.deep.equal([
        'read',
        'apply network speed 1000:2000 / network delay 100:100',
      ]);
      expect(note.firstCall.args[2]).to.deep.equal({
        emulatorShape: { upKbps: 0, downKbps: 0, minLatencyMs: 5, maxLatencyMs: 5 },
      });
      expect((await ledger.get('s1'))?.emulatorShape?.minLatencyMs).to.equal(5);
      expect(svc.getLatency('s1')).to.equal(100);
    });

    it('3G, then Offline, then Normal, then the end: back to exactly where it started', async () => {
      adb.answers['shell settings get global mobile_data'] = '0';
      const c = fakeConsole({ upKbps: 0, downKbps: 0, minLatencyMs: 5, maxLatencyMs: 5 });
      const svc = service(c);
      const steps: ProfileOutcome[] = [];

      steps.push(await svc.setProfile('s1', emulator(), '3G'));
      steps.push(await svc.setProfile('s1', emulator(), 'Offline'));
      steps.push(await svc.setProfile('s1', emulator(), 'Offline'));
      steps.push(await svc.setProfile('s1', emulator(), 'Normal'));
      expect(steps.map((s) => s.appTraffic)).to.deep.equal([
        'shaped',
        'radios',
        'radios',
        'radios',
      ]);
      // Offline read the radios once, however often it was asked for.
      expect(adb.commands('emulator-5554')).to.deep.equal([
        'shell settings get global wifi_on',
        'shell settings get global mobile_data',
        'shell svc data disable',
        'shell svc wifi disable',
        // Leaving Offline turns back on what was on: Wi-Fi only.
        'shell svc wifi enable',
      ]);
      expect(c.now()).to.deep.equal(UNSHAPED);

      await svc.reset('s1');
      expect(c.now()).to.deep.equal({ upKbps: 0, downKbps: 0, minLatencyMs: 5, maxLatencyMs: 5 });
      expect(await ledger.list()).to.deep.equal([]);
      expect(svc.has('s1')).to.equal(false);
    });

    it("an emulator's Normal, with nothing shaped yet, leaves its console alone", async () => {
      const c = fakeConsole();
      const outcome = await service(c).setProfile('s1', emulator(), 'Normal');
      expect(outcome.appTraffic).to.equal('radios');
      expect(c.calls).to.deep.equal([]);
    });

    it("a real phone's 3G is a command delay only; its console is never asked", async () => {
      const c = fakeConsole();
      const outcome = await service(c).setProfile('s1', realPhone(), '3G');
      expect(outcome).to.deep.equal({ profile: '3G', appTraffic: 'none', commandDelayMs: 100 });
      expect(c.calls).to.deep.equal([]);
      expect(adb.calls).to.deep.equal([]);
    });

    it("an iPhone's profile is a command delay only", async () => {
      const outcome = await service(fakeConsole()).setProfile(
        's1',
        { udid: 'ios-1', platform: 'ios', realDevice: true } as any,
        'Offline',
      );
      expect(outcome.appTraffic).to.equal('none');
    });

    it("a console that can't be reached delays commands only, and says so once", async () => {
      const c = fakeConsole(UNSHAPED, new Error('no emulator console on port 5554'));
      const svc = service(c);
      const warn = sinon.spy((svc as any).log, 'warn');
      const first = await svc.setProfile('s1', emulator(), 'Edge');
      await svc.setProfile('s2', emulator(), '4G');
      expect(first.appTraffic).to.equal('none');
      expect(warn.callCount).to.equal(1);
      expect(await ledger.list()).to.deep.equal([]);
    });

    it('refuses a profile that is not one of the five', async () => {
      let thrown: any;
      await service(fakeConsole())
        .setProfile('s1', emulator(), '5G' as any)
        .catch((e) => (thrown = e));
      expect(String(thrown?.message)).to.include('Unknown network profile "5G"');
    });

    it('describe() answers the profile in force and what it does', async () => {
      const svc = service(fakeConsole());
      expect(svc.describe('s1')).to.equal(undefined);
      await svc.setProfile('s1', emulator(), 'Edge');
      expect(svc.describe('s1')).to.deep.equal({
        profile: 'Edge',
        appTraffic: 'shaped',
        commandDelayMs: 400,
      });
    });

    it('puts back the shaping a crashed session left, from the ledger', async () => {
      await ledger.note('crashed', 'emulator-5554', {
        emulatorShape: { upKbps: 0, downKbps: 0, minLatencyMs: 0, maxLatencyMs: 0 },
      });
      const c = fakeConsole({ upKbps: 150, downKbps: 250, minLatencyMs: 400, maxLatencyMs: 400 });
      const restore = new PhoneNetworkRestore();
      restore.consoleFor = () => c.console;
      expect(await restore.restoreLeftovers({})).to.equal(1);
      expect(c.now()).to.deep.equal(UNSHAPED);
      expect(await ledger.list()).to.deep.equal([]);
    });

    it("keeps the record when the emulator's console can't be reached, to try again", async () => {
      await ledger.note('crashed', 'emulator-5554', { emulatorShape: UNSHAPED });
      const restore = new PhoneNetworkRestore();
      restore.consoleFor = () => fakeConsole(UNSHAPED, new Error('gone')).console;
      expect(await restore.restoreLeftovers({})).to.equal(0);
      expect((await ledger.list()).map((e) => e.sessionId)).to.deep.equal(['crashed']);
    });
  });

  describe('xenon: setNetworkProfile and getNetworkProfile', () => {
    let restore: () => void;
    let setProfile: sinon.SinonStub;

    beforeEach(() => {
      restore = saveRegistrations(NetworkConditioningService);
      const svc = new NetworkConditioningService();
      setProfile = sinon
        .stub(svc, 'setProfile')
        .callsFake(async (_sid: string, _device: any, profile: any) => ({
          profile,
          appTraffic: 'shaped',
          commandDelayMs: 100,
        }));
      Container.set(NetworkConditioningService, svc);
      sinon.stub(DeviceService, 'updateCmdExecutedTime').resolves();
      sinon.stub(OwnDeviceRow, 'findOwnDevice').resolves(emulator());
    });
    afterEach(() => {
      sinon.restore();
      restore();
    });

    const run = (script: string, args: unknown) =>
      Container.get(CommandInterceptor).handle(
        async () => 'the driver ran it',
        { sessionId: 'sess-1', caps: { udid: 'emulator-5554', platformName: 'Android' } },
        'execute',
        [script, [args]],
        {} as any,
        false,
      );

    it("sets the session's profile on its own phone's row, and answers the outcome", async () => {
      const out = await run('xenon: setNetworkProfile', { profile: '3G' });
      expect(out).to.deep.equal({ profile: '3G', appTraffic: 'shaped', commandDelayMs: 100 });
      expect(setProfile.firstCall.args[0]).to.equal('sess-1');
      expect(setProfile.firstCall.args[1]).to.include({ udid: 'emulator-5554', realDevice: false });
      expect((await run('xe: setNetworkProfile', { profile: 'Offline' })).profile).to.equal(
        'Offline',
      );
    });

    it('refuses a profile that is not one of the five, with the list', async () => {
      let thrown: any;
      await run('xenon: setNetworkProfile', { profile: 'fast' }).catch((e) => (thrown = e));
      expect(thrown?.error).to.equal('invalid argument');
      expect(String(thrown?.message)).to.include('Normal, 4G, 3G, Edge, Offline');
      expect(setProfile.called).to.equal(false);
    });

    it('getNetworkProfile answers Normal for a session with none', async () => {
      expect(await run('xenon: getNetworkProfile', {})).to.deep.equal({
        profile: 'Normal',
        appTraffic: 'none',
        commandDelayMs: 0,
      });
    });

    it('a script without the xenon: prefix goes to the driver', async () => {
      expect(await run('setNetworkProfile', { profile: '3G' })).to.equal('the driver ran it');
      expect(setProfile.called).to.equal(false);
    });
  });
});
