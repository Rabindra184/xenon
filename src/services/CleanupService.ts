import { prisma } from '../prisma';
import { Service } from 'typedi';
import log from '../logger';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { IPluginArgs } from '../interfaces/IPluginArgs';
import {
  selectExpiredRecordings,
  selectOrphanDirectories,
  isRecordingSweepSafe,
} from './recording/recordingCleanup';

/** Subdirectory holding composite (multi-device) outputs, keyed by group id. */
const GROUPS_DIR = '_groups';

@Service()
export class CleanupService {
  private readonly log = log.scope('CleanupService');

  /**
   * Orchestrates build + session + recording cleanup based on retention policy.
   *
   * Phases:
   *  1. Purge old builds (by age AND count cap) together with their sessions.
   *  2. Sweep orphan sessions (no build_id) older than the retention window —
   *     otherwise ad-hoc sessions accumulate forever.
   *  3. Purge expired Live Devices recordings and sweep unreachable recording
   *     directories (issue #209) — the one asset class nothing used to remove.
   */
  public async runCleanup(pluginArgs: IPluginArgs): Promise<void> {
    const {
      buildCleanupDays = 30,
      buildCleanupMaxCount = 100,
      deleteBuildAssets = true,
    } = pluginArgs;

    this.log.info(
      `Starting cleanup: Retention = ${buildCleanupDays} days, Max Builds = ${buildCleanupMaxCount}, Purge Assets = ${deleteBuildAssets}`,
    );

    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() - buildCleanupDays);

    try {
      const buildIdsToPurge = new Set<string>();

      // 1. Identify builds to delete (by age)
      const buildsByAge = await prisma.build.findMany({
        where: {
          createdAt: {
            lt: expirationDate,
          },
        },
        select: { id: true },
      });

      buildsByAge.forEach((b) => buildIdsToPurge.add(b.id));

      // 2. Identify builds to delete (by count)
      const totalBuilds = await prisma.build.count();
      if (totalBuilds > buildCleanupMaxCount) {
        const buildsToKeep = await prisma.build.findMany({
          orderBy: { createdAt: 'desc' },
          take: buildCleanupMaxCount,
          select: { id: true },
        });
        const keepIds = new Set(buildsToKeep.map((b) => b.id));

        const allBuildIDs = await prisma.build.findMany({ select: { id: true } });
        for (const b of allBuildIDs) {
          if (!keepIds.has(b.id)) {
            buildIdsToPurge.add(b.id);
          }
        }
      }

      if (buildIdsToPurge.size > 0) {
        this.log.info(`Identified ${buildIdsToPurge.size} builds for purging.`);
        for (const buildId of buildIdsToPurge) {
          await this.purgeBuild(buildId, deleteBuildAssets);
        }
      } else {
        this.log.info('No builds identified for cleanup.');
      }

      // 3. Orphan sessions (no build_id) older than retention window. Without
      //    this, ad-hoc sessions (WebDriver runs with no build capability) are
      //    never cleaned up — their assets accumulate on disk forever.
      await this.purgeOrphanSessions(expirationDate, deleteBuildAssets);

      // 4. Recordings have their own windows — a failed recording holds no
      //    playable file, so it need not linger as long as real footage.
      await this.purgeRecordings(pluginArgs);

      this.log.info('✅ Build cleanup completed successfully.');
    } catch (err: any) {
      this.log.error(`❌ Cleanup failed: ${err.message}`);
    }
  }

  /**
   * Retention for Live Devices recordings (issue #209).
   *
   * Two halves, in order — expiring rows first means their directories are
   * unreachable by the time the sweep runs, so both are reclaimed in one pass:
   *  a. delete rows past the age/count policy, and their files;
   *  b. remove directories no surviving row points into.
   *
   * Bookmarks and annotations cascade on the row delete, so no child cleanup
   * is needed here.
   */
  private async purgeRecordings(pluginArgs: IPluginArgs): Promise<void> {
    const {
      recordingCleanupDays = 30,
      recordingCleanupMaxCount = 100,
      recordingFailedCleanupDays = 2,
    } = pluginArgs;

    const rows = await prisma.recording.findMany({
      select: { id: true, status: true, started_at: true, file_path: true, group_id: true },
    });

    const expiredIds = selectExpiredRecordings({
      rows,
      now: Date.now(),
      days: recordingCleanupDays,
      maxCount: recordingCleanupMaxCount,
      failedDays: recordingFailedCleanupDays,
    });

    if (expiredIds.length > 0) {
      const expired = new Set(expiredIds);
      for (const r of rows) {
        if (expired.has(r.id) && r.file_path) this.unlinkSilently(r.file_path);
      }
      await prisma.recording.deleteMany({ where: { id: { in: expiredIds } } });
      this.log.info(
        `Purged ${expiredIds.length} expired recording(s) ` +
          `(retention ${recordingCleanupDays}d / max ${recordingCleanupMaxCount}, ` +
          `failed ${recordingFailedCleanupDays}d).`,
      );
    } else {
      this.log.info('No recordings past their retention window.');
    }

    this.sweepOrphanRecordingDirs(
      rows.filter((r) => !expiredIds.includes(r.id)),
      rows.length,
    );
  }

  /**
   * Remove recording directories nothing in the DB can reach.
   *
   * Reachability is decided by `file_path`, never by the directory name — see
   * selectOrphanDirectories for why the name is not a safe key.
   */
  private sweepOrphanRecordingDirs(
    survivors: Array<{ file_path: string | null; group_id: string | null }>,
    totalRowsRead: number,
  ): void {
    const base = config.recordingsAssetsPath;
    let deviceDirs: string[] = [];
    let groupDirs: string[] = [];
    try {
      if (!fs.existsSync(base)) return;
      deviceDirs = fs
        .readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== GROUPS_DIR)
        .map((e) => path.join(base, e.name));
      const groupsBase = path.join(base, GROUPS_DIR);
      if (fs.existsSync(groupsBase)) {
        groupDirs = fs
          .readdirSync(groupsBase, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => path.join(groupsBase, e.name));
      }
    } catch (err: any) {
      this.log.warn(`Could not list recording directories: ${err.message}`);
      return;
    }

    if (
      !isRecordingSweepSafe({
        rowCount: totalRowsRead,
        dirCount: deviceDirs.length + groupDirs.length,
      })
    ) {
      this.log.warn(
        `Refusing to sweep ${deviceDirs.length + groupDirs.length} recording directories: the ` +
          'Recording table read returned no rows. That is what a failed or mis-scoped query ' +
          'looks like, and sweeping on it would delete the whole tree. Sweep manually if the ' +
          'table really is empty.',
      );
      return;
    }

    const orphans = selectOrphanDirectories({
      deviceDirs,
      groupDirs,
      livePaths: survivors.map((r) => r.file_path).filter((p): p is string => !!p),
      liveGroupIds: survivors.map((r) => r.group_id).filter((g): g is string => !!g),
    });

    let removed = 0;
    for (const dir of orphans) {
      if (this.removeRecordingDirectory(dir)) removed++;
    }
    if (removed > 0) {
      this.log.info(
        `Swept ${removed} unreachable recording director${removed === 1 ? 'y' : 'ies'}.`,
      );
    }
  }

  /** rm -rf a recording directory, refusing anything outside the tree. */
  private removeRecordingDirectory(dir: string): boolean {
    const base = path.resolve(config.recordingsAssetsPath);
    const target = path.resolve(dir);
    if (!target.startsWith(base + path.sep)) {
      this.log.warn(`Refusing to remove recording dir outside the tree: ${dir}`);
      return false;
    }
    try {
      fs.rmSync(target, { recursive: true, force: true });
      this.log.debug(`Removed orphan recording directory: ${target}`);
      return true;
    } catch (err: any) {
      this.log.warn(`Failed to remove recording dir ${target}: ${err.message}`);
      return false;
    }
  }

  /**
   * Completely purges a build, its sessions, and all associated metadata/assets.
   */
  public async purgeBuild(buildId: string, deleteAssets: boolean): Promise<void> {
    const sessions = await prisma.session.findMany({
      where: { build_id: buildId },
      select: {
        id: true,
        video_recording: true,
        performance_trace: true,
      },
    });

    for (const session of sessions) {
      await this.purgeSessionAssets(session, deleteAssets);
      await this.deleteSessionChildren(session.id);
    }

    // Delete sessions for this build
    await prisma.session.deleteMany({ where: { build_id: buildId } });

    // Finally delete the build
    await prisma.build.delete({ where: { id: buildId } });
    this.log.debug(`Purged build: ${buildId} (${sessions.length} sessions removed)`);
  }

  /**
   * Purge sessions with no parent build that are older than the retention
   * window. Runs after build purging so build-owned sessions are already gone.
   */
  private async purgeOrphanSessions(cutoff: Date, deleteAssets: boolean): Promise<void> {
    const orphans = await prisma.session.findMany({
      where: {
        build_id: null,
        createdAt: { lt: cutoff },
      },
      select: {
        id: true,
        video_recording: true,
        performance_trace: true,
      },
    });

    if (orphans.length === 0) {
      this.log.info('No orphan sessions to purge.');
      return;
    }

    this.log.info(`Purging ${orphans.length} orphan session(s) older than cutoff.`);
    for (const session of orphans) {
      await this.purgeSessionAssets(session, deleteAssets);
      await this.deleteSessionChildren(session.id);
    }
    await prisma.session.deleteMany({
      where: {
        build_id: null,
        createdAt: { lt: cutoff },
      },
    });
  }

  /**
   * Deletes the assets owned by a single session: video, performance trace,
   * all screenshots referenced by its logs, and finally a recursive sweep of
   * the session's on-disk directory. That last sweep catches anything the DB
   * didn't know about — partial pipeline writes, aborted recordings, stray
   * screenshot dumps — so the session folder is guaranteed empty after cleanup.
   */
  private async purgeSessionAssets(
    session: { id: string; video_recording: string | null; performance_trace: string | null },
    deleteAssets: boolean,
  ): Promise<void> {
    if (!deleteAssets) return;

    if (session.video_recording) {
      this.unlinkSilently(session.video_recording);
    }
    if (session.performance_trace) {
      this.unlinkSilently(session.performance_trace);
    }

    // Screenshots live on SessionLog rows, one per UI command. Fetch just the
    // paths so we don't pull full payloads into memory for long sessions.
    const shots = await prisma.sessionLog.findMany({
      where: { session_id: session.id, screenshot: { not: null } },
      select: { screenshot: true },
    });
    for (const s of shots) {
      if (s.screenshot) this.unlinkSilently(s.screenshot);
    }

    // Final sweep: rm -rf the session directory. Files we already unlinked
    // are no-ops; this phase catches the untracked strays.
    this.removeSessionDirectory(session.id);
  }

  private async deleteSessionChildren(sessionId: string): Promise<void> {
    await Promise.all([
      prisma.sessionLog.deleteMany({ where: { session_id: sessionId } }),
      prisma.log.deleteMany({ where: { session_id: sessionId } }),
      prisma.profiling.deleteMany({ where: { session_id: sessionId } }),
    ]);
  }

  private removeSessionDirectory(sessionId: string): void {
    // Defense against path traversal: reject anything that, when joined and
    // normalized, escapes sessionAssetsPath. sessionId is a UUID in normal
    // use but a corrupted DB row shouldn't let us rm -rf arbitrary paths.
    const base = path.resolve(config.sessionAssetsPath);
    const target = path.resolve(base, sessionId);
    if (!target.startsWith(base + path.sep) && target !== base) {
      this.log.warn(`Refusing to remove suspicious session dir: ${sessionId}`);
      return;
    }
    if (target === base) {
      this.log.warn('Refusing to remove sessionAssetsPath itself');
      return;
    }
    try {
      fs.rmSync(target, { recursive: true, force: true });
      this.log.debug(`Removed session directory: ${target}`);
    } catch (err: any) {
      this.log.warn(`Failed to remove session dir ${target}: ${err.message}`);
    }
  }

  private unlinkSilently(filePath: string): void {
    // Asset paths in the DB are stored relative to sessionAssetsPath (see
    // asset-manager.ts). Resolving them against cwd — which the prior
    // implementation did implicitly — means fs.existsSync always returned
    // false and nothing ever got unlinked. Always go via path.resolve.
    if (!filePath) return;
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(config.sessionAssetsPath, filePath);
    try {
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
        this.log.debug(`Deleted asset: ${resolved}`);
      }
    } catch (e: any) {
      this.log.warn(`Failed to delete asset ${resolved}: ${e.message}`);
    }
  }
}
