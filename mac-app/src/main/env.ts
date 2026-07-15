import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { accessSync, constants, existsSync, statSync } from 'node:fs';

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

let cachedPath: string | null = null;

async function loginShellPath(): Promise<string | null> {
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    // -ilc runs an interactive login shell so ~/.zprofile, ~/.zshrc, nvm, etc. apply.
    const { stdout } = await execFileAsync(shell, ['-ilc', 'echo "__PATH__:$PATH"'], {
      timeout: 5000,
      encoding: 'utf8'
    });
    const match = stdout.match(/__PATH__:(.*)/);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

/** Resolve the effective PATH once and cache it for the process lifetime. */
export async function resolvePath(): Promise<string> {
  if (cachedPath) return cachedPath;

  const parts = new Set<string>();
  const shellPath = await loginShellPath();
  if (shellPath) {
    for (const p of shellPath.split(':')) if (p) parts.add(p);
  }
  for (const dir of COMMON_BIN_DIRS) if (existsSync(dir)) parts.add(dir);
  for (const p of (process.env.PATH || '').split(':')) if (p) parts.add(p);

  cachedPath = Array.from(parts).join(':');
  return cachedPath;
}

/** Build an env object with a corrected PATH, layering extra vars on top. */
export async function buildEnv(extra: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  const PATH = await resolvePath();
  return { ...process.env, PATH, ...extra };
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
