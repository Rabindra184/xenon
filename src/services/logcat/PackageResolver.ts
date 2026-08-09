/**
 * Resolves a logcat PID to the process that produced the line.
 *
 * logcat does not emit a package; Android Studio shows one by resolving the
 * pid separately. This does the same, at emit time, so the label reflects the
 * moment the line was produced.
 *
 * Correctness note: pids are reused when a process dies. A stale label is
 * WORSE than no label — it is silently plausible. So the whole table is
 * replaced on every refresh and entries whose pid is gone are dropped, rather
 * than merged forward.
 */
export const DEFAULT_TTL_MS = 10_000;

export class PackageResolver {
  private table = new Map<number, string>();
  private loadedAt = -Infinity;
  private inflight?: Promise<void>;

  constructor(
    private readonly runPs: () => Promise<string>,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(pid: number): Promise<string | undefined> {
    // Track whether THIS call already refreshed, rather than re-reading the
    // clock. Comparing `now() - loadedAt > 0` after a refresh is 0 under an
    // injected clock but a small positive under the real one, which would make
    // the refresh count non-deterministic between tests and production.
    const wasStale = this.now() - this.loadedAt > this.ttlMs;
    if (wasStale) await this.refresh();

    const hit = this.table.get(pid);
    if (hit) return hit;
    if (wasStale) return undefined; // already refreshed this call; genuinely unknown

    // Table was fresh but the pid is missing — the process may have started
    // since. Try exactly once more, then accept that it is unknown.
    await this.refresh();
    return this.table.get(pid);
  }

  private async refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const out = await this.runPs();
        this.table = parsePs(out);
        this.loadedAt = this.now();
      } catch {
        // Never let package resolution block or drop a log line. Keep whatever
        // table we had and try again after the TTL.
        this.loadedAt = this.now();
      } finally {
        this.inflight = undefined;
      }
    })();
    return this.inflight;
  }
}

/** `  PID NAME` rows from `ps -A -o PID,NAME`. Unparseable rows are skipped. */
function parsePs(out: string): Map<number, string> {
  const table = new Map<number, string>();
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+)\s*$/.exec(line);
    if (m) table.set(Number(m[1]), m[2]);
  }
  return table;
}
