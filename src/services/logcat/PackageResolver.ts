import log from '../../logger';

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

/** The exact `ps` invocation this parser is written against. */
export const PS_COMMAND = 'ps -A -o PID,NAME';

/**
 * One data row of {@link PS_COMMAND}: exactly two whitespace-separated
 * columns, numeric pid first.
 *
 * The two-column shape is a hard contract, not a convenience. Plain `ps -A`
 * emits nine columns and matches nothing here, so every label would silently
 * vanish with no other symptom. `refresh()` therefore treats "output arrived
 * but no row parsed" as a degradation and says so, instead of failing quiet.
 */
const PS_ROW = /^\s*(\d+)\s+(\S+)\s*$/;

export class PackageResolver {
  private readonly logger = log.scope('PackageResolver');
  private table = new Map<number, string>();
  /**
   * Negative cache: pids proven absent from the table we are currently
   * serving. Without it a pid that `ps` never lists re-triggers the warm-miss
   * refresh on every single log line — an adb round-trip per line, which is
   * exactly what the TTL exists to prevent. Cleared wherever `table` is
   * replaced, so it can never outlive the snapshot it was derived from.
   */
  private missed = new Set<number>();
  /** Time of the last *successful* load. Only success moves this. */
  private loadedAt = -Infinity;
  /**
   * Time of the last refresh attempt, success or failure. Because a failure
   * deliberately leaves `loadedAt` alone, this is what keeps a broken `ps`
   * from being re-spawned once per log line.
   */
  private attemptedAt = -Infinity;
  private inflight?: Promise<void>;
  /** True while `ps` is unusable, so the warning fires per transition, not per call. */
  private degraded = false;

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
    const wasStale = this.isStale();
    if (wasStale && this.now() - this.attemptedAt > this.ttlMs) await this.refresh();

    // Still stale means the refresh failed (or was throttled after a recent
    // failure). Serving the old table now would be serving an unboundedly old
    // label — the one outcome the spec calls worse than no label at all.
    if (this.isStale()) return undefined;

    const hit = this.table.get(pid);
    if (hit) return hit;
    if (wasStale) {
      this.missed.add(pid); // already refreshed this call; genuinely unknown
      return undefined;
    }
    if (this.missed.has(pid)) return undefined; // proven absent from this snapshot

    // `ps` is already known broken — another spawn would fail too. Without
    // this, every distinct unknown pid in the window storms a doomed `ps`
    // call; a healthy `ps` is deliberately NOT throttled here, since a warm
    // miss picking up a newly-started process is real, load-bearing behaviour.
    if (this.degraded) {
      this.missed.add(pid);
      return undefined;
    }

    // Table was fresh but the pid is missing — the process may have started
    // since. Try exactly once more, then mark it unknown for this snapshot.
    await this.refresh();
    if (this.isStale()) return undefined;
    const second = this.table.get(pid);
    if (second) return second;
    // Marked even when that refresh failed: `missed` is only cleared when the
    // table is replaced, so the mark cannot survive a snapshot it disagrees
    // with, and it stops a failing `ps` storming one call per line.
    this.missed.add(pid);
    return undefined;
  }

  /** Is the table older than the TTL, and therefore not fit to serve? */
  private isStale(): boolean {
    return this.now() - this.loadedAt > this.ttlMs;
  }

  private async refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        // Force a suspension before invoking the runner. Without this, a
        // `runPs` that throws SYNCHRONOUSLY (e.g. building an adb command
        // from an undefined path) runs entirely within this IIFE's
        // synchronous prefix: catch/finally clear `inflight` before the
        // assignment below ever executes, so the assignment then overwrites
        // it with the already-settled promise — wedging `resolve()` behind
        // `if (this.inflight) return this.inflight` forever. An `async`
        // runner is naturally immune; a plain function is not.
        const out = await Promise.resolve().then(() => this.runPs());
        const parsed = parsePs(out);
        if (parsed.size === 0) {
          // `ps` can exit 0 and still be useless: `error: device offline` on
          // stdout, or the wrong column set. Keeping the previous table here
          // would carry stale entries forward, so the snapshot is dropped
          // whole — an absent label beats a plausible wrong one.
          this.enterDegraded(
            `\`${PS_COMMAND}\` returned no parseable "PID NAME" rows (first line: ${firstLine(out)})`,
          );
        } else {
          this.leaveDegraded();
        }
        this.table = parsed;
        this.missed.clear();
        this.loadedAt = this.now();
      } catch (e) {
        // Never let package resolution block or drop a log line. Keep the
        // table until it ages out of the TTL, and do NOT touch `loadedAt`: a
        // failing refresh must not extend the freshness of data it failed to
        // fetch.
        this.enterDegraded(
          `\`${PS_COMMAND}\` failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        this.attemptedAt = this.now();
        // Whatever `runPs` does, the slot is freed the moment this attempt
        // settles, so one bad call cannot poison every later one. `refresh()`
        // returns early whenever `inflight` is set and `inflight` is only
        // ever cleared here, so two refresh bodies can never overlap — there
        // is no "newer refresh" this release could ever clear out from under.
        // A `runPs` that never settles at all can only be bounded by a
        // timeout inside the runner itself, not here.
        this.inflight = undefined;
      }
    })();
    return this.inflight;
  }

  /** Warn on the way into the failing state only — this runs per log line. */
  private enterDegraded(reason: string): void {
    if (this.degraded) return;
    this.degraded = true;
    this.logger.warn(
      `package labels unavailable: ${reason}. Log lines keep streaming without pkg.`,
    );
  }

  private leaveDegraded(): void {
    if (!this.degraded) return;
    this.degraded = false;
    this.logger.info('package labels recovered');
  }
}

/** `  PID NAME` rows from `ps -A -o PID,NAME`. Unparseable rows are skipped. */
function parsePs(out: string): Map<number, string> {
  const table = new Map<number, string>();
  for (const line of out.split('\n')) {
    const m = PS_ROW.exec(line);
    if (m) table.set(Number(m[1]), m[2]);
  }
  return table;
}

/** First non-blank line, clipped — enough to recognise a wrong `ps` shape in a log. */
function firstLine(out: string): string {
  const line = out.split('\n').find((l) => l.trim().length > 0);
  if (!line) return '<empty>';
  const trimmed = line.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}
