// AndroidDeviceManager's module reaches TypeDI's Container.get as it loads,
// which needs reflect-metadata first: imported here, so the helper loads
// whoever imports it, and first.
import 'reflect-metadata';
import sinon from 'sinon';
import { Container } from 'typedi';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';
import { saveRegistrations } from './container-registration';
import { forbidRealAdb, lastAfterAll } from './no-real-adb';

/**
 * A stand-in for the resolved adb (`AndroidDeviceManager.getAdbForDevice`):
 * it records every `adbExec` argument list and answers from `answers`, keyed
 * by the arguments after `-s <udid>` joined with spaces. An `Error` answer is
 * thrown. Nothing reaches a real phone.
 */
export interface FakeAdb {
  /** Every call's full argument list, in order. */
  calls: string[][];
  /** The calls for one phone, without the `-s <udid>` prefix. */
  commands(udid?: string): string[];
  answers: Record<string, string | Error>;
}

export function fakeAdb(answers: Record<string, string | Error> = {}): FakeAdb {
  const fake: FakeAdb = {
    calls: [],
    answers,
    commands(udid?: string) {
      return fake.calls
        .filter((args) => udid === undefined || args[1] === udid)
        .map((args) => args.slice(2).join(' '));
    },
  };
  return fake;
}

/**
 * Registers `fake` as every phone's adb for the enclosing `describe`, from its
 * first `before` to its last `after`, and refuses this machine's real adb
 * there (forbidRealAdb): the describe fails if anything starts it.
 *
 * Through 2.36 the fake was registered per test and taken off in an
 * `afterEach` that ran before the describe's own: a reset in that `afterEach`
 * (svc.reset, a session's restore) reached the real adb with the fake serial.
 */
export function useFakeAdb(get: () => FakeAdb): void {
  forbidRealAdb();
  let restore: (() => void) | undefined;
  before(function () {
    restore = saveRegistrations(AndroidDeviceManager);
    Container.set(AndroidDeviceManager, {
      getAdbForDevice: async (udid: string) => ({
        adbExec: async (args: string[]) => {
          const fake = get();
          fake.calls.push(args);
          const key = args.slice(args[0] === '-s' ? 2 : 0).join(' ');
          const answer = fake.answers[`${udid} ${key}`] ?? fake.answers[key];
          if (answer instanceof Error) throw answer;
          return answer ?? '';
        },
      }),
    } as any);
    // Taken off after every `after` of the describe, however they are written.
    lastAfterAll(this, 'the real adb manager back', () => {
      restore?.();
      restore = undefined;
    });
  });
}

/**
 * A stand-in for the appium-adb instance device discovery holds
 * (`AndroidDeviceManager.getAdb`, what `ADB.createADB` makes): `adbExec` and
 * `shell` record their arguments and answer from `answers` (keyed as in
 * fakeAdb, an `Error` is thrown) or with ''. Discovery's probes (the phone's
 * ip, CPU, screen size, identity) then read nothing from a real phone.
 * `ADB.createADB` itself runs `adb start-server`, so a spec never calls it.
 */
export interface FakeDiscoveryAdb {
  calls: string[][];
  answers: Record<string, string | Error>;
  adbPort: number;
  adbHost: undefined;
  adbRemoteHost: undefined;
  executable: { path: string; defaultArgs: string[] };
  adbExec(args: string[], opts?: unknown): Promise<string>;
  shell(cmd: string | string[], opts?: unknown): Promise<string>;
  clone(opts?: unknown): FakeDiscoveryAdb;
}

export function fakeDiscoveryAdb(answers: Record<string, string | Error> = {}): FakeDiscoveryAdb {
  const answer = (args: string[]) => {
    const key = args.slice(args[0] === '-s' ? 2 : 0).join(' ');
    const found = answers[`${args[0] === '-s' ? args[1] : ''} ${key}`] ?? answers[key];
    if (found instanceof Error) throw found;
    return found ?? '';
  };
  const instance: FakeDiscoveryAdb = {
    calls: [],
    answers,
    adbPort: 5037,
    adbHost: undefined,
    adbRemoteHost: undefined,
    // Nothing is there: a caller that ran it would fail to start, not reach a phone.
    executable: { path: '/nonexistent/xenon-spec/platform-tools/adb', defaultArgs: [] },
    async adbExec(args: string[]) {
      instance.calls.push(args);
      return answer(args);
    },
    async shell(cmd: string | string[]) {
      const args = ['shell', ...(Array.isArray(cmd) ? cmd : [cmd])];
      instance.calls.push(args);
      return answer(args);
    },
    clone: () => instance,
  };
  return instance;
}

/**
 * Device discovery's adb (`AndroidDeviceManager.getAdb`, on every instance)
 * is `adb` (fakeDiscoveryAdb() unless given) for the enclosing `describe`,
 * from its first `before` to its last `after`, with forbidRealAdb's guard.
 * For specs that build the device managers and allocate or discover phones:
 * allocation asks the phone for its screen size, CPU and ip
 * (getAdditionalDeviceInfo). Its own sandbox, so a spec's `sinon.restore()`
 * leaves it; an instance stub of `getAdb` still wins.
 */
export function useFakeDiscoveryAdb(adb: () => FakeDiscoveryAdb = sharedDiscoveryAdb()): void {
  forbidRealAdb();
  before(function () {
    const sandbox = sinon.createSandbox();
    sandbox
      .stub(AndroidDeviceManager.prototype as any, 'getAdb')
      .callsFake(async () => ({ adbInstance: adb(), adbTracker: undefined }));
    lastAfterAll(this, 'the real adb discovery back', () => sandbox.restore());
  });
}

function sharedDiscoveryAdb(): () => FakeDiscoveryAdb {
  let instance: FakeDiscoveryAdb | undefined;
  return () => (instance ??= fakeDiscoveryAdb());
}
