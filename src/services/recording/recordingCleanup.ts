import path from 'path';

/**
 * Retention decisions for Live Devices recordings (issue #209).
 *
 * Recordings were the one asset class nothing ever removed: `CleanupService`
 * covers Builds and Sessions — `session.video_recording` is the Appium session
 * video, a different model — and `recordings.ts` exposes no DELETE route. On the
 * machine in the report the tree had reached 313MB across 78 directories, the
 * oldest three months past the 30-day build window, and **265MB of it was
 * unreachable**: directories no DB row pointed at, left behind by failed starts.
 *
 * Everything here is pure. The destructive half of a cleanup job is precisely
 * what you cannot afford to discover in production, so the rules are decided in
 * functions that can be tested exhaustively without a DB or a filesystem.
 */

export interface ExpiryCandidate {
  id: string;
  status: string;
  started_at: Date | string | number | null;
}

export interface ExpiryPolicy {
  rows: ExpiryCandidate[];
  now: number;
  /** Age in days past which a finished recording is dropped. */
  days: number;
  /** Cap on retained finished recordings; oldest-first eviction beyond it. */
  maxCount: number;
  /** Much shorter window for FAILED rows — they hold no playable file. */
  failedDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A recording still being written. Never a deletion candidate. */
function isInFlight(status: string): boolean {
  return status === 'RECORDING';
}

function ageMs(startedAt: ExpiryCandidate['started_at'], now: number): number | undefined {
  if (startedAt === null || startedAt === undefined) return undefined;
  const t = startedAt instanceof Date ? startedAt.getTime() : new Date(startedAt).getTime();
  if (!Number.isFinite(t)) return undefined;
  return now - t;
}

/**
 * Ids to purge, given the retention policy. Mirrors the build policy's shape —
 * age AND a count cap — with a separate, shorter window for failures.
 *
 * In-flight rows are excluded from both rules: deleting a row and its file out
 * from under a running ffmpeg would corrupt an active capture, and letting them
 * count toward the cap would mean starting a large group recording evicts
 * finished ones.
 */
export function selectExpiredRecordings(policy: ExpiryPolicy): string[] {
  const { rows, now, days, maxCount, failedDays } = policy;
  const expired = new Set<string>();
  const survivors: Array<{ id: string; at: number }> = [];

  for (const r of rows) {
    if (isInFlight(r.status)) continue;

    const age = ageMs(r.started_at, now);
    // No usable timestamp: leave it alone rather than treat it as epoch 0 and
    // delete it instantly. A retention job must never delete on missing data.
    if (age === undefined) continue;

    const limitDays = r.status === 'FAILED' ? failedDays : days;
    if (age > limitDays * DAY_MS) {
      expired.add(r.id);
    } else {
      survivors.push({ id: r.id, at: now - age });
    }
  }

  // Count cap applies to what survived the age rules, newest kept.
  if (maxCount >= 0 && survivors.length > maxCount) {
    survivors
      .sort((a, b) => b.at - a.at)
      .slice(maxCount)
      .forEach((s) => expired.add(s.id));
  }

  return [...expired];
}

export interface OrphanScan {
  /** Absolute paths of per-recording directories (excluding the _groups tree). */
  deviceDirs: string[];
  /** Absolute paths of directories under _groups. */
  groupDirs: string[];
  /** `file_path` of every recording still in the DB. */
  livePaths: string[];
  /** `group_id` of every recording still in the DB. */
  liveGroupIds: string[];
}

/**
 * Directories no surviving row can reach.
 *
 * **Reachability is the file_path, never the directory name.** The obvious
 * test — delete any directory not named after a `Recording.id` — is wrong and
 * destructive: on the reporter's machine only 35 of 39 rows were id-named, and
 * that test flagged 4 directories holding live recordings (directory
 * `4c9babeb…` belongs to row `c5930c7b…`). A guard caught it before anything
 * was removed; this function encodes the corrected rule.
 */
export function selectOrphanDirectories(scan: OrphanScan): string[] {
  const orphans: string[] = [];
  const live = scan.livePaths.map((p) => path.resolve(p));

  for (const dir of scan.deviceDirs) {
    const prefix = path.resolve(dir) + path.sep;
    // Compare on a path boundary so /…/ab does not appear to contain /…/abc.
    if (!live.some((p) => p.startsWith(prefix))) orphans.push(dir);
  }

  const groups = new Set(scan.liveGroupIds);
  for (const dir of scan.groupDirs) {
    // Composite output IS group-keyed (compositeOutputPath(groupId)), so here
    // the directory name is authoritative — unlike the per-recording dirs.
    if (!groups.has(path.basename(dir))) orphans.push(dir);
  }

  return orphans;
}

/**
 * Whether an orphan sweep may proceed.
 *
 * Guards the one failure mode that turns this job into data loss: if the row
 * query fails or is mis-scoped and returns nothing, every directory looks
 * unreachable and the sweep deletes the entire tree. No rows plus no
 * directories is a genuinely empty install and fine.
 */
export function isRecordingSweepSafe(counts: { rowCount: number; dirCount: number }): boolean {
  return counts.rowCount > 0 || counts.dirCount === 0;
}
