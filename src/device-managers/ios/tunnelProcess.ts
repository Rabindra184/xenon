/**
 * Process-tree helpers for go-ios tunnels.
 *
 * `ios tunnel start --userspace` (run with ENABLE_GO_IOS_AGENT=yes) forks
 * self-supervising *agent* children. Their argv is a bare `ios tunnel start`
 * with no `--udid`, so a udid-scoped `pkill` can never see them; and if their
 * spawning parent dies without reaping the whole tree, the surviving agents
 * keep re-forking — a runaway process/memory storm (observed: 300+ processes,
 * 5+ GB, growing every few seconds).
 *
 * These helpers close that gap two ways:
 *   - by *process group* — a tunnel spawned {@link tunnelSpawnOptions detached}
 *     leads its own group, so {@link killProcessGroup} reaps its agent children
 *     with it (used for a single udid, safe alongside other devices' tunnels);
 *   - by *binary path* — {@link reapAllOrphanTunnels} kills every process
 *     running the vendored go-ios binary, a safe catch-all when the server owns
 *     no legitimate tunnel (fresh boot, or full shutdown).
 */
import type { SpawnOptions } from 'child_process';

export type KillFn = (pid: number, signal?: NodeJS.Signals | number) => void;
export type ExecFn = (cmd: string) => Promise<{ stdout: string; stderr: string }>;

const defaultKill: KillFn = (pid, signal) => process.kill(pid, signal);

/**
 * Spawn options for a go-ios tunnel. `detached: true` makes the tunnel the
 * leader of its own process group, so {@link killProcessGroup} can reap the
 * self-forking agent children as a group. Without it a group kill silently
 * no-ops and the agents leak.
 */
export function tunnelSpawnOptions(env: NodeJS.ProcessEnv): SpawnOptions {
  return {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    detached: true,
  };
}

/** Parse newline-separated pgrep output into safe numeric pids (never <= 1). */
function parsePids(stdout: string): number[] {
  return stdout
    .trim()
    .split('\n')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 1); // never touch pid <= 1 (launchd/init)
}

/**
 * Kill a process together with its entire process group. Signals `-pid` (the
 * group) first so a detached tunnel's forked agent children die with it; if the
 * pid is not a group leader or is already gone, falls back to a direct kill.
 * pids <= 1 / non-integers are ignored so we can never signal init/launchd or,
 * via a negative pid, "every process we may signal".
 */
export function killProcessGroup(
  pid: number | undefined | null,
  signal: NodeJS.Signals = 'SIGKILL',
  kill: KillFn = defaultKill,
): void {
  if (pid == null || !Number.isInteger(pid) || pid <= 1) return;
  try {
    kill(-pid, signal); // negative pid => whole process group
  } catch {
    try {
      kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Reap the tunnel process tree(s) for a single udid without disturbing other
 * devices' tunnels. Finds the top-level `ios tunnel ... <udid>` processes
 * (whose argv carries the udid) and group-kills each, taking their udid-less
 * agent children down with them.
 */
export async function reapTunnelsForUdid(
  udid: string,
  exec: ExecFn,
  kill: KillFn = defaultKill,
): Promise<void> {
  const patterns = [`ios tunnel.*${udid}`, `go-ios.*tunnel.*${udid}`];
  const seen = new Set<number>();
  for (const pattern of patterns) {
    let pids: number[] = [];
    try {
      const { stdout } = await exec(`pgrep -f "${pattern}"`);
      pids = parsePids(stdout);
    } catch {
      /* pgrep exits 1 when nothing matches */
    }
    for (const pid of pids) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      killProcessGroup(pid, 'SIGKILL', kill);
    }
  }
}

/**
 * Boot/shutdown catch-all: reap every process running the vendored go-ios
 * binary. Matched by absolute path, so it cannot hit a user's other `ios`
 * tools. Safe only when the server owns no legitimate tunnel (fresh boot, or
 * full shutdown). Returns how many processes were found (best-effort).
 */
export async function reapAllOrphanTunnels(goIOSPath: string, exec: ExecFn): Promise<number> {
  let count = 0;
  try {
    const { stdout } = await exec(`pgrep -f "${goIOSPath}"`);
    count = parsePids(stdout).length;
  } catch {
    /* pgrep exits 1 when nothing matches */
  }
  if (count > 0) {
    try {
      await exec(`pkill -9 -f "${goIOSPath}"`);
    } catch {
      /* pkill exits 1 if they vanished between pgrep and pkill */
    }
  }
  return count;
}
