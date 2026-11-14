// The module object itself, never an `import *` copy of it: replacing a
// property must be seen by every module that calls `child_process.spawn`.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const childProcess: Record<string, (...args: any[]) => any> = require('child_process');

/**
 * Keeps a spec from running this machine's adb. The machine a spec runs on
 * may be a lab's, with real phones on its adb server, and the phone-network
 * code turns radios off and rewrites proxies: a fake serial is harmless only
 * while no phone has it.
 *
 * For the enclosing `describe`, from its first `before` to its last `after`,
 * every `child_process` call that would start an `adb` (by the program's
 * name, any path: appium-adb runs the SDK's `platform-tools/adb`) throws
 * instead, and the describe fails at its end, naming each command. Anything
 * else is started as usual. `useFakeAdb()` calls it, so a spec that registers
 * the fake adb has the guard too.
 *
 * appium-adb and teen_process call `child_process.spawn` through the module
 * object, so replacing its properties is seen by every caller.
 */
export function forbidRealAdb(): void {
  let spawned: string[];
  let release: (() => void) | undefined;
  before(function () {
    spawned = [];
    release = guard((command) => spawned.push(command));
    // The check runs after every `after` the describe has, wherever it is
    // written, so a teardown that reaches adb is caught too: the suite's own
    // afterAll list, which Mocha reads only once the describe's tests are done.
    lastAfterAll(this, 'no real adb was run', () => {
      release?.();
      release = undefined;
      if (spawned.length) {
        throw new Error(
          `This describe ran this machine's adb (${spawned.length}x), which reaches real ` +
            `phones: ${[...new Set(spawned)].join('; ')}. Register a fake one (useFakeAdb).`,
        );
      }
    });
  });
}

/**
 * Adds `fn` to the `after` hooks of the describe whose `before` hook `ctx` is
 * running, after every one it has: Mocha reads a suite's after-all hooks only
 * once its tests are done, so a hook added now runs last.
 */
export function lastAfterAll(ctx: Mocha.Context, title: string, fn: () => void): void {
  const suite = ctx.test?.parent;
  if (!suite) throw new Error('lastAfterAll: call it from a before hook');
  suite.afterAll(title, fn);
}

/** What `guard` reports and throws: one adb command a spec tried to start. */
export class RealAdbRefused extends Error {}

const GUARDED = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync'] as const;

type Listener = (command: string) => void;
const listeners = new Set<Listener>();
let originals: Partial<Record<(typeof GUARDED)[number], (...args: any[]) => any>> | undefined;

/**
 * Starts refusing adb, reporting each refused command to `onRefused`, and
 * returns the function that stops. Nested guards share one wrapper.
 */
export function guard(onRefused: Listener): () => void {
  listeners.add(onRefused);
  if (!originals) install();
  return () => {
    listeners.delete(onRefused);
    if (listeners.size === 0) uninstall();
  };
}

function install(): void {
  const cp = childProcess;
  originals = {};
  for (const name of GUARDED) {
    const original = cp[name];
    originals[name] = original;
    cp[name] = function (this: unknown, ...args: any[]) {
      const command = adbCommand(name, args);
      if (command !== undefined) {
        for (const listener of listeners) listener(command);
        throw new RealAdbRefused(`A spec tried to run this machine's adb: ${command}`);
      }
      return original.apply(this, args);
    };
  }
}

function uninstall(): void {
  const cp = childProcess;
  for (const name of GUARDED) {
    const original = originals?.[name];
    if (original) cp[name] = original;
  }
  originals = undefined;
}

/** The command line, when the call would start adb; else undefined. */
export function adbCommand(method: string, args: any[]): string | undefined {
  const [file, rest] = args;
  if (typeof file !== 'string') return undefined;
  if (method === 'exec' || method === 'execSync') {
    // A shell line: its first word is the program.
    const program = file.trim().split(/\s+/)[0] ?? '';
    return isAdb(program.replace(/^['"]|['"]$/g, '')) ? file : undefined;
  }
  if (!isAdb(file)) return undefined;
  return [file, ...(Array.isArray(rest) ? rest : [])].join(' ');
}

function isAdb(program: string): boolean {
  // Either separator, so a Windows SDK path counts on any machine.
  const name = program.split(/[\\/]/).pop() ?? '';
  return /^adb(\.exe)?$/i.test(name);
}
