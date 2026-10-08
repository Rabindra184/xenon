import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Where an e2e run may put the app and a server it starts. The suite runs on a developer's own Mac,
// whose ~/.appium holds their own Xenon and must never be used, read or written by a run. So every
// launch gets a throwaway HOME, a server starts from a sandbox Appium folder the developer names in
// XENON_E2E_APPIUM_HOME, and a guard fails the run if the app ever resolves the real ~/.appium.
//
// Nothing here imports Playwright, so the unit suite can prove the guard with a stand-in home.

/** The variable naming the sandbox Appium folder, one with Xenon installed, that real starts use. */
export const SANDBOX_VAR = 'XENON_E2E_APPIUM_HOME';

/** Why a test that needs a sandbox is skipped without one. */
export const SANDBOX_SKIP =
  'Set XENON_E2E_APPIUM_HOME to a folder with Xenon installed (APPIUM_HOME=<dir> appium plugin install …) to run the tests that start a server.';

/** Where a folder holds Xenon: the same marker the app looks for (toolchainRules' PLUGIN_MARKER). */
export const xenonPackageJson = (appiumHome: string): string =>
  path.join(appiumHome, 'node_modules', '@xenon-device-management', 'xenon', 'package.json');

/**
 * The real user's home, from the account database rather than $HOME: a run sets $HOME to a
 * throwaway folder, and so might the shell it was started from.
 */
export const realUserHome = (): string => os.userInfo().homedir;

/** macOS reaches the data volume through /System/Volumes/Data as well (a firmlink, not a symbolic link). */
const DATA_VOLUME = '/System/Volumes/Data';

function comparable(p: string): string {
  let out = path.resolve(p);
  if (out === DATA_VOLUME || out.startsWith(DATA_VOLUME + path.sep)) out = out.slice(DATA_VOLUME.length) || path.sep;
  // APFS is case-insensitive by default: ~/.APPIUM is the same folder.
  return out.toLowerCase();
}

/** Whether `p` is `folder` or inside it, by name. */
function within(p: string, folder: string): boolean {
  const a = comparable(p);
  const b = comparable(folder);
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}

/** The ~/.appium folders that are off limits: the real home's, by its name and by its resolved name. */
function forbiddenFolders(realHome: string): string[] {
  const named = path.join(realHome, '.appium');
  let resolvedHome = realHome;
  try {
    // The home folder itself, never anything inside it.
    resolvedHome = realpathSync.native(realHome);
  } catch {
    /* no such home: its name is all there is to compare */
  }
  return [...new Set([named, path.join(resolvedHome, '.appium')])];
}

/**
 * Whether `dir` is the real ~/.appium or inside it. Symbolic links on the way are followed one
 * part at a time, and the walk stops the moment it reaches ~/.appium, so that folder is never
 * looked at, listed or read: only the names leading to it are compared.
 */
export function isUnderRealAppiumHome(dir: string, realHome: string = realUserHome()): boolean {
  const forbidden = forbiddenFolders(realHome);
  const hits = (p: string) => forbidden.some((f) => within(p, f));
  const pending = path.resolve(dir).split(path.sep).filter(Boolean);
  let at: string = path.sep;
  let links = 0;
  while (pending.length > 0) {
    const next = path.join(at, pending.shift()!);
    if (hits(next)) return true;
    let target: string | null = null;
    try {
      if (lstatSync(next).isSymbolicLink()) target = readlinkSync(next);
    } catch {
      /* not there: the rest of the path is names only */
    }
    if (target === null) {
      at = next;
      continue;
    }
    if (++links > 40) throw new Error(`Too many symbolic links in ${dir}`);
    pending.unshift(...path.resolve(at, target).split(path.sep).filter(Boolean));
    at = path.sep;
  }
  return hits(at);
}

/** What the guard looks at: a folder the app resolved, or a launch config it wrote, with where it came from. */
export interface Resolved {
  what: string;
  path: string;
}

/** The ones of `folders` that are the real ~/.appium or inside it. */
export function realAppiumHomeHits(folders: Resolved[], realHome: string = realUserHome()): Resolved[] {
  return folders.filter((f) => f.path.trim() !== '' && isUnderRealAppiumHome(f.path, realHome));
}

/** The launch configs (`launch-configs/*.yaml`) in a run's user-data folder that name the real ~/.appium. */
export function launchConfigHits(userDataDir: string, realHome: string = realUserHome()): Resolved[] {
  const dir = path.join(userDataDir, 'launch-configs');
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.yaml'));
  } catch {
    return [];
  }
  const forbidden = forbiddenFolders(realHome).map((f) => f.toLowerCase());
  const hits: Resolved[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let text: string;
    try {
      text = readFileSync(file, 'utf8').toLowerCase();
    } catch {
      continue; // deleted as it was read (a profile's config goes with the profile)
    }
    // An APPIUM_HOME in it, by any key, written out in full or with ~ for the home folder.
    const mentions = forbidden.some((f) => text.includes(f)) || /(^|[\s'"=:])~\/\.appium(\/|\s|'|"|$)/m.test(text);
    if (mentions) hits.push({ what: `launch config ${name}`, path: file });
  }
  return hits;
}

/** Throws, loudly, when anything the app resolved or wrote is under the real ~/.appium. */
export function assertNoRealAppiumHome(
  folders: Resolved[],
  userDataDir: string | null,
  realHome: string = realUserHome()
): void {
  const hits = [...realAppiumHomeHits(folders, realHome), ...(userDataDir ? launchConfigHits(userDataDir, realHome) : [])];
  if (hits.length === 0) return;
  throw new Error(
    `E2E GUARD: the app under test reached the real ${path.join(realHome, '.appium')}, which a run must never use:\n` +
      hits.map((h) => `  ${h.what}: ${h.path}`).join('\n') +
      '\nStop and check the harness (test/e2e/sandbox.ts, helpers.ts launchApp).'
  );
}

/**
 * The sandbox Appium folder for real starts: XENON_E2E_APPIUM_HOME when it is set and holds Xenon,
 * else null (and the tests that need it are skipped). One under the real ~/.appium is refused
 * before anything looks inside it.
 */
export function xenonSandbox(env: NodeJS.ProcessEnv = process.env, realHome: string = realUserHome()): string | null {
  const named = env[SANDBOX_VAR]?.trim();
  if (!named) return null;
  const dir = path.resolve(named);
  if (isUnderRealAppiumHome(dir, realHome)) {
    throw new Error(`E2E GUARD: ${SANDBOX_VAR} (${named}) is the real ~/.appium or inside it. Use a sandbox folder.`);
  }
  return existsSync(xenonPackageJson(dir)) ? dir : null;
}

/** The version of the Xenon in an Appium folder, from its package.json. */
export function xenonVersionIn(appiumHome: string): string {
  return (JSON.parse(readFileSync(xenonPackageJson(appiumHome), 'utf8')) as { version: string }).version;
}

/** A value for a POSIX shell, in single quotes (a single quote in it closes, escapes and reopens). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The startup files the app's login shell reads (zsh and bash), in a home made for one launch. */
export const SHELL_STARTUP_FILES = ['.zshrc', '.bashrc', '.bash_profile'];

/**
 * A throwaway HOME for one launch. The app asks the login shell for PATH, the Android SDK and
 * APPIUM_HOME (src/main/env.ts), and the shell reads its startup files from HOME: these export the
 * test process's own PATH and Android SDK, so the app finds the same Node, Appium and adb the run
 * does, and APPIUM_HOME only when a sandbox is given. ~/.appium and ~/.cache/xenon are then this
 * folder's, never the developer's.
 */
export function makeThrowawayHome(opts: { env?: NodeJS.ProcessEnv; appiumHome?: string | null } = {}): string {
  const env = opts.env ?? process.env;
  const home = mkdtempSync(path.join(os.tmpdir(), 'xenon-e2e-throwaway-home-'));
  const lines = ['# Written by the Xenon Control e2e harness for one launch: this run\'s own tools, nothing of the developer\'s.'];
  for (const name of ['PATH', 'ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    const value = env[name];
    if (value) lines.push(`export ${name}=${shellQuote(value)}`);
  }
  if (opts.appiumHome) lines.push(`export APPIUM_HOME=${shellQuote(opts.appiumHome)}`);
  const text = lines.join('\n') + '\n';
  for (const file of SHELL_STARTUP_FILES) writeFileSync(path.join(home, file), text);
  return home;
}

/**
 * The test process's environment as the app should inherit it: without what could point the app,
 * its shell or a server at the developer's own folders (APPIUM_HOME, a database, the shell's own
 * startup folder or files).
 */
export function inheritedEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const dropped = new Set(['APPIUM_HOME', 'DATABASE_URL', 'ZDOTDIR', 'BASH_ENV', 'ENV', SANDBOX_VAR]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !dropped.has(k)) out[k] = v;
  return out;
}
