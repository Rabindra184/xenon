import { prisma } from '../prisma';
import { Service } from 'typedi';
import log from '../logger';
import fs from 'fs';
import { IPluginArgs } from '../interfaces/IPluginArgs';

@Service()
export class CleanupService {
  private readonly log = log.scope('CleanupService');

  /**
   * Orchestrates the build and session cleanup based on retention policy.
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

    try {
      const buildIdsToPurge = new Set<string>();

      // 1. Identify builds to delete (by age)
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() - buildCleanupDays);

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

      if (buildIdsToPurge.size === 0) {
        this.log.info('No builds identified for cleanup.');
        return;
      }

      this.log.info(`Identified ${buildIdsToPurge.size} builds for purging.`);

      // 3. Purge sessions and assets for these builds
      for (const buildId of buildIdsToPurge) {
        await this.purgeBuild(buildId, deleteBuildAssets);
      }

      this.log.info('✅ Build cleanup completed successfully.');
    } catch (err: any) {
      this.log.error(`❌ Cleanup failed: ${err.message}`);
    }
  }

  /**
   * Completely purges a build, its sessions, and all associated metadata/assets.
   */
  public async purgeBuild(buildId: string, deleteAssets: boolean): Promise<void> {
    const sessions = await prisma.session.findMany({
      where: { build_id: buildId },
      include: {
        SessionLog: {
          select: { screenshot: true },
          where: { screenshot: { not: null } },
        },
      },
    });

    for (const session of sessions) {
      if (deleteAssets) {
        // Delete video
        if (session.video_recording) {
          this.unlinkSilently(session.video_recording);
        }

        // Delete screenshots
        for (const logItem of session.SessionLog) {
          if (logItem.screenshot) {
            this.unlinkSilently(logItem.screenshot);
          }
        }
      }

      // Delete relations
      // Note: We use deleteMany which is efficient.
      await Promise.all([
        prisma.sessionLog.deleteMany({ where: { session_id: session.id } }),
        prisma.log.deleteMany({ where: { session_id: session.id } }),
        prisma.profiling.deleteMany({ where: { session_id: session.id } }),
      ]);
    }

    // Delete sessions for this build
    await prisma.session.deleteMany({ where: { build_id: buildId } });

    // Finally delete the build
    await prisma.build.delete({ where: { id: buildId } });
    this.log.debug(`Purged build: ${buildId} (${sessions.length} sessions removed)`);
  }

  private unlinkSilently(filePath: string): void {
    try {
      // Check if it's a valid path and exists
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this.log.debug(`Deleted asset: ${filePath}`);
      }
    } catch (e: any) {
      this.log.warn(`Failed to delete asset ${filePath}: ${e.message}`);
    }
  }
}
