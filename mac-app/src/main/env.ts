import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { SHELL_VAR_PREFIX, deriveAndroidHome, parseShellVars } from './toolchainRules';

const execFileAsync = promisify(execFile);

// A macOS app launched from Finder/Dock does NOT inherit the user's shell PATH.
// Without fixing this, `appium`, `node`, `adb`, `xcodebuild`, etc. are not found.
// We resolve the real PATH once by asking the user's login shell, and fall back
// to a set of well-known locations if that fails.

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

let cachedPath: string | null = null;
let cachedShellVars: Record<string, string> | null = null;
let cachedAndroidHome: string | null | undefined;

/** Ask the user's login shell for the vars a GUI launch doesn't inherit. */
async function loginShellVars(): Promise<Record<string, string>> {
  if (cachedShellVars) return cachedShellVars;
  const shell = process.env.SHELL || '/bin/zsh';
  const script = ['PATH', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'APPIUM_HOME']
    .map((v) => `echo "${SHELL_VAR_PREFIX}${v}__:$${v}"`)
    .join('; ');
  try {
    // -ilc runs an interactive login shell so ~/.zprofile, ~/.zshrc, nvm, etc. apply.
    const { stdout } = await execFileAsync(shell, ['-ilc', script], { timeout: 5000, encoding: 'utf8' });
    cachedShellVars = parseShellVars(stdout);
  } catch {
    cachedShellVars = {};
  }
  return cachedShellVars;
}

/** Resolve the effective PATH once and cache it for the process lifetime. */
export async function resolvePath(): Promise<string> {
  if (cachedPath) return cachedPath;

  const parts = new Set<string>();
  const shellPath = (await loginShellVars()).PATH;
  if (shellPath) {
    for (const p of shellPath.split(':')) if (p) parts.add(p);
  }
  for (const dir of COMMON_BIN_DIRS) if (existsSync(dir)) parts.add(dir);
  for (const p of (process.env.PATH || '').split(':')) if (p) parts.add(p);

  cachedPath = Array.from(parts).join(':');
  return cachedPath;
}

/**
 * Resolve the Android SDK root once: shell export → process env → adb's own
 * location → the conventional path. Returns null when there's no SDK to find.
 */
export async function resolveAndroidHome(): Promise<string | null> {
  if (cachedAndroidHome !== undefined) return cachedAndroidHome;
  const shell = await loginShellVars();
  cachedAndroidHome = deriveAndroidHome({
    androidHome: shell.ANDROID_HOME ?? process.env.ANDROID_HOME,
    sdkRoot: shell.ANDROID_SDK_ROOT ?? process.env.ANDROID_SDK_ROOT,
    adbPath: await which('adb'),
    defaultSdkDir: existsSync(DEFAULT_SDK_DIR) ? DEFAULT_SDK_DIR : null
  });
  return cachedAndroidHome;
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
  const vars = await loginShellVars();
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
