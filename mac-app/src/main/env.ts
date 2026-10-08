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

/** How long the read before the first window may take: 5 s, as before 0.3.0, so the window is never later (R82). */
export const LAUNCH_SHELL_TIMEOUT_MS = 5_000;
/** How long a later read may take. A busy Mac or a heavy ~/.zshrc can take several seconds. */
export const LOGIN_SHELL_TIMEOUT_MS = 15_000;
/** How often a look nobody asked for (launch, window focus, Start) tries a failed read again (R82). */
export const FAILED_READ_RETRY_MS = 60_000;

// What the login shell said, and what is built from it, is kept only once a read has worked (R80).
// Every look reuses a good read; only Check again and Try again forget it (R82). A read that failed
// (it took too long, say) is never kept, but it is not tried again by every call, nor every look:
// Check again and Try again try it at once, any other look at most once a minute. Meanwhile PATH is
// the well-known folders and the app's own.
let shellVars: Record<string, string> | null = null;
/** The read under way; calls made while it runs share it. */
let reading: Promise<Record<string, string> | null> | null = null;
/** The last read failed, and is not to be tried again yet. */
let readFailed = false;
/** When it failed (Date.now()). */
let failedAt = 0;
/** How many reads have answered, so a look can tell it read the shell anew. */
let goodReads = 0;
/** Bumped when what was read is forgotten, so a read still running then is not kept. */
let generation = 0;
let cachedPath: string | null = null;
let cachedAndroidHome: string | null | undefined;

/** The read before the first window: it may take 5 s, as before 0.3.0 (R82). The answer is kept as any other. */
export async function readLoginShellAtLaunch(): Promise<void> {
  await loginShell(LAUNCH_SHELL_TIMEOUT_MS);
}

/**
 * A look at this Mac begins (a preflight), and the login shell is settled for it. One the person
 * asked for (Check again, Try again) forgets what the shell said and the PATH and Android SDK found
 * with it, and reads the shell again: a ~/.zshrc changed since, or a read that came too late, is
 * picked up. Any other look (launch, window focus, Start's own check) reuses a good read, and tries a
 * failed one again only when a minute has passed since it failed. `readAnew`: the shell was read for
 * this look and answered, so what was worked out from it (the automatic Appium folder) is worked out again.
 */
export async function beginLook(look: { fresh: boolean }): Promise<{ readAnew: boolean }> {
  if (look.fresh) {
    generation += 1;
    shellVars = null;
    reading = null;
    readFailed = false;
    cachedPath = null;
    cachedAndroidHome = undefined;
  } else if (readFailed && Date.now() - failedAt >= FAILED_READ_RETRY_MS) {
    readFailed = false;
  }
  const before = goodReads;
  await loginShell();
  return { readAnew: goodReads > before };
}

async function readLoginShell(timeoutMs: number): Promise<Record<string, string>> {
  const shell = process.env.SHELL || '/bin/zsh';
  const script = ['PATH', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'APPIUM_HOME']
    .map((v) => `echo "${SHELL_VAR_PREFIX}${v}__:$${v}"`)
    .join('; ');
  // -ilc runs an interactive login shell so ~/.zprofile, ~/.zshrc, nvm, etc. apply. execFile's timeout
  // kills the shell, but its answer waits for the output to close, which a program the ~/.zshrc started
  // can hold open for as long as it runs: the timer below gives up on the read regardless.
  let timer: NodeJS.Timeout | undefined;
  const giveUp = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The login shell took too long.')), timeoutMs + 500);
  });
  try {
    const read = execFileAsync(shell, ['-ilc', script], { timeout: timeoutMs, encoding: 'utf8' });
    read.catch(() => {}); // a read given up on may still fail later; nobody waits for it then
    const { stdout } = await Promise.race([read, giveUp]);
    return parseShellVars(stdout);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the user's login shell for the vars a GUI launch doesn't inherit. `ok` is false when it couldn't
 * say. `timeoutMs` is for a read this call starts; one already under way is shared as it is.
 */
async function loginShell(timeoutMs = LOGIN_SHELL_TIMEOUT_MS): Promise<{ vars: Record<string, string>; ok: boolean }> {
  if (shellVars) return { vars: shellVars, ok: true };
  if (readFailed) return { vars: {}, ok: false };
  if (!reading) {
    const made = generation;
    reading = readLoginShell(timeoutMs).then(
      (vars) => {
        if (made === generation) {
          shellVars = vars;
          goodReads += 1;
          reading = null;
        }
        return vars;
      },
      () => {
        if (made === generation) {
          readFailed = true;
          failedAt = Date.now();
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
