import { PassThrough } from 'stream';
import {
  LogcatStreamService,
  type ChildProcessLike,
} from '../../src/device-managers/android/LogcatStreamService';
import { PackageResolver } from '../../src/services/logcat/PackageResolver';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** A threadtime line logged at `at` by this machine's local clock. */
export function lineAt(at: number, msg: string, level = 'I', tag = 'Tag', pid = 4127): string {
  const t = new Date(at);
  return (
    `${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:` +
    `${pad(t.getSeconds())}.${pad(t.getMilliseconds(), 3)}  ${pid}  ${pid} ${level} ${tag}: ${msg}\n`
  );
}

/** An `adb logcat` child whose output the test writes. */
export function fakeProc() {
  const stdout = new PassThrough();
  const handlers: Record<string, ((a?: unknown) => void)[]> = {};
  return {
    stdout,
    killed: false,
    on(ev: string, cb: (a?: unknown) => void) {
      (handlers[ev] ||= []).push(cb);
    },
    /** The process ends, as when the phone restarts or is unplugged. */
    exit() {
      stdout.end();
      (handlers.close || []).forEach((h) => h());
    },
    kill() {
      this.killed = true;
    },
  };
}
export type FakeProc = ReturnType<typeof fakeProc>;

/** The real stream service, its `adb logcat` children fake. */
export class FakeLogcatStreams extends LogcatStreamService {
  procs: FakeProc[] = [];
  protected async spawnLogcat(): Promise<ChildProcessLike> {
    const proc = fakeProc();
    this.procs.push(proc);
    return proc as unknown as ChildProcessLike;
  }
  protected makeResolver(): PackageResolver {
    return new PackageResolver(async () => '  PID NAME\n 4127 com.example.app\n');
  }
  get proc(): FakeProc {
    return this.procs[this.procs.length - 1];
  }
}

/** Lets readline, the stream's package lookups and the mux deliver what was written. */
export const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

export const until = async (check: () => boolean, ms = 2_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};
