import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { SHELL_VAR_PREFIX, deriveAndroidHome, parseShellVars } from './toolchainRules';

const execFileAsync = promisify(execFile);

// A macOS app launched from Finder/Dock does NOT inherit the user's shell PATH.
// Without fixing this, `appium`, `node`, `adb`, `xcodebuild`, etc. are not found.
// We resolve the real PATH by asking the user's login shell, and fall back to a
// set of well-known locations while that fails.

const COMMON_BIN_DIRS = [
  '/opt/homebrew/bin', // Apple Silicon Homebrew
  '/opt/homebrew/sbin',
  '/usr/local/bin', // Intel Homebrew
  '/usr/local/sbin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  path.join(os.homedir(), '.nvm/current/bin'),
  path.join(os.homedir(), '.volta/bin'),
  path.join(os.homedir(), '.asdf/shims'),
  path.join(os.homedir(), '.local/bin')
];

/** Conventional Android SDK location on macOS. */
const DEFAULT_SDK_DIR = path.join(os.homedir(), 'Library/Android/sdk');

/** How long the login shell may take. A busy Mac or a heavy ~/.zshrc can take several seconds. */
export const LOGIN_SHELL_TIMEOUT_MS = 15_000;

// What the login shell said, and what is built from it, is kept only once a read has worked (R80).
// A read that failed (it took too long, say) is not kept: every call of the look that made it goes
// without it rather than wait on the shell again, and the next look reads the shell again.
let shellVars: Record<string, string> | null = null;
/** The read under way; calls made while it runs share it. */
let reading: Promise<Record<string, string> | null> | null = null;
/** This look's read failed. */
let readFailed = false;
/** Bumped when what was read is forgotten, so a read still running then is not kept. */
let generation = 0;
let cachedPath: string | null = null;
let cachedAndroidHome: string | null | undefined;

/**
 * A look at this Mac begins (a preflight). One the person asked for (Check again, Try again, Start's
 * own look) forgets what the login shell said and the PATH and Android SDK found with it, so the shell
 * is read again: a ~/.zshrc changed since, or a read that came too late, is picked up. Any other look
 * (window focus, a changed port) keeps a good read and reads the shell again only if the last read failed.
 */
export function beginLook(look: { fresh: boolean }): void {
  if (look.fresh) {
    generation += 1;
    shellVars = null;
    reading = null;
    cachedPath = null;
    cachedAndroidHome = undefined;
  }
  readFailed = false;
}

async function readLoginShell(): Promise<Record<string, string>> {
  const shell = process.env.SHELL || '/bin/zsh';
  const script = ['PATH', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'APPIUM_HOME']
    .map((v) => `echo "${SHELL_VAR_PREFIX}${v}__:$${v}"`)
    .join('; ');
  // -ilc runs an interactive login shell so ~/.zprofile, ~/.zshrc, nvm, etc. apply. execFile's timeout
  // kills the shell, but its answer waits for the output to close, which a program the ~/.zshrc started
  // can hold open for as long as it runs: the timer below gives up on the read regardless.
  let timer: NodeJS.Timeout | undefined;
  const giveUp = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The login shell took too long.')), LOGIN_SHELL_TIMEOUT_MS + 500);
  });
  try {
    const read = execFileAsync(shell, ['-ilc', script], { timeout: LOGIN_SHELL_TIMEOUT_MS, encoding: 'utf8' });
    read.catch(() => {}); // a read given up on may still fail later; nobody waits for it then
    const { stdout } = await Promise.race([read, giveUp]);
    return parseShellVars(stdout);
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the user's login shell for the vars a GUI launch doesn't inherit. `ok` is false when it couldn't say. */
async function loginShell(): Promise<{ vars: Record<string, string>; ok: boolean }> {
  if (shellVars) return { vars: shellVars, ok: true };
  if (readFailed) return { vars: {}, ok: false };
  if (!reading) {
    const made = generation;
    reading = readLoginShell().then(
      (vars) => {
        if (made === generation) {
          shellVars = vars;
          reading = null;
        }
        return vars;
      },
      () => {
        if (made === generation) {
          readFailed = true;
          reading = null;
        }
        return null;
      }
    );
  }
  const vars = await reading;
  return vars ? { vars, ok: true } : { vars: {}, ok: false };
}

/** Resolve the effective PATH, kept once the login shell has said its PATH. */
export async function resolvePath(): Promise<string> {
  if (cachedPath) return cachedPath;
  const made = generation;
  const { vars, ok } = await loginShell();

  const parts = new Set<string>();
  if (vars.PATH) {
    for (const p of vars.PATH.split(':')) if (p) parts.add(p);
  }
  for (const dir of COMMON_BIN_DIRS) if (existsSync(dir)) parts.add(dir);
  for (const p of (process.env.PATH || '').split(':')) if (p) parts.add(p);

  const resolved = Array.from(parts).join(':');
  if (ok && made === generation) cachedPath = resolved;
  return resolved;
}

/**
 * Resolve the Android SDK root: shell export → process env → adb's own location → the conventional
 * path. Returns null when there's no SDK to find. Kept, as PATH is, once the login shell has said.
 */
export async function resolveAndroidHome(): Promise<string | null> {
  if (cachedAndroidHome !== undefined) return cachedAndroidHome;
  const made = generation;
  const { vars: shell, ok } = await loginShell();
  const androidHome = deriveAndroidHome({
    androidHome: shell.ANDROID_HOME ?? process.env.ANDROID_HOME,
    sdkRoot: shell.ANDROID_SDK_ROOT ?? process.env.ANDROID_SDK_ROOT,
    adbPath: await which('adb'),
    defaultSdkDir: existsSync(DEFAULT_SDK_DIR) ? DEFAULT_SDK_DIR : null
  });
  if (ok && made === generation) cachedAndroidHome = androidHome;
  return androidHome;
}

/**
 * Build an env object with a corrected PATH plus the Android SDK vars, layering
 * extra vars on top.
 *
 * ANDROID_HOME matters because the plugin's Android device discovery reads it
 * directly: a GUI launch inherits no shell exports, so without this the server
 * logs "Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable was
 * exported" even on hosts where adb works fine. `extra` still wins, so a
 * profile's own env var overrides what we detect.
 */
export async function buildEnv(extra: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  const PATH = await resolvePath();
  const androidHome = await resolveAndroidHome();
  const android = androidHome ? { ANDROID_HOME: androidHome, ANDROID_SDK_ROOT: androidHome } : {};
  return { ...process.env, PATH, ...android, ...extra };
}

/** $APPIUM_HOME as exported by the user's login shell, if any. */
export async function shellAppiumHome(): Promise<string | null> {
  const { vars } = await loginShell();
  return vars.APPIUM_HOME?.trim() || process.env.APPIUM_HOME?.trim() || null;
}

/**
 * Resolve the absolute path to an executable using the corrected PATH.
 * Node's child_process does not honor a custom env.PATH for command lookup, so
 * we must resolve binaries ourselves before spawning.
 */
export async function which(cmd: string): Promise<string | null> {
  const PATH = await resolvePath();
  for (const dir of PATH.split(':')) {
    if (!dir) continue;
    const candidate = path.join(dir, cmd);
    try {
      const st = statSync(candidate);
      if (st.isFile()) {
        accessSync(candidate, constants.X_OK);
        return candidate;
      }
    } catch {
      /* not here, keep looking */
    }
  }
  return null;
}
