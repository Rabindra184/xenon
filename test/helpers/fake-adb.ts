import { Container } from 'typedi';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';
import { saveRegistrations } from './container-registration';

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
 * Registers `fake` as every phone's adb for the enclosing `describe`. Returns
 * nothing: the registration is put back after each test.
 */
export function useFakeAdb(get: () => FakeAdb): void {
  let restore: () => void;
  beforeEach(() => {
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
  });
  afterEach(() => restore());
}
