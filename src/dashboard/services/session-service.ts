import { prisma } from '../../prisma';
import log from '../../logger';

export async function getOrCreateNewBuild(buildName: string) {
  // Principal Logic: Find the LATEST build with this name to check for a "Warm Window"
  const build = await prisma.build.findFirst({
    where: {
      name: buildName,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  if (build) {
    const lastUpdate = new Date(build.updatedAt).getTime();
    const now = Date.now();
    const diffInMinutes = (now - lastUpdate) / (1000 * 60);

    // If the build was active within the last 30 minutes, treat it as the "current" run.
    if (diffInMinutes < 30) {
      // Principal Optimization: "Touch" the build to refresh the window for subsequent sessions.
      // This keeps the build 'alive' as long as sessions are trickling in.
      return await prisma.build.update({
        where: { id: build.id },
        data: { updatedAt: new Date() },
      });
    }
  }

  // If no build found OR the existing one is "stone cold" (>30 mins), create a fresh record
  return await prisma.build.create({
    data: {
      name: buildName,
    },
  });
}

export async function getSessionById(sessionId: string) {
  return await prisma.session.findFirst({
    where: {
      id: sessionId,
    },
  });
}

export async function updateSessionDetails(sessionId: string, data: any) {
  return await prisma.session.update({
    where: {
      id: sessionId,
    },
    data,
  });
}

/**
 * Principal Protection: Marks all orphaned "running" sessions as FAILED.
 * This should be called on plugin initialization to clear crashes from previous runs.
 * @param ignoreSessionIds - Array of session IDs that were successfully recovered and should NOT be cleaned up.
 */
export async function cleanupZombieSessions(ignoreSessionIds: string[] = []) {
  const whereClause: any = {
    status: 'running',
  };

  if (ignoreSessionIds.length > 0) {
    whereClause.id = { notIn: ignoreSessionIds };
  }

  const orphanedSessions = await prisma.session.findMany({
    where: whereClause,
  });

  if (orphanedSessions.length > 0) {
    log.info(`[Dashboard] Cleaning up ${orphanedSessions.length} zombie sessions...`);
    await prisma.session.updateMany({
      where: whereClause,
      data: {
        status: 'failed',
        failure_reason: 'Session interrupted (Server restart or process crash)',
        endTime: new Date(),
      },
    });
  }

  // Principal Repair: Assign sessions with no build_id to "Default Build"
  const missingBuildSessions = await prisma.session.count({
    where: { build: null },
  });

  if (missingBuildSessions > 0) {
    log.info(`[Dashboard] Repairing ${missingBuildSessions} orphaned sessions...`);
    const defaultBuild = await getOrCreateNewBuild('Default Build');
    await prisma.session.updateMany({
      where: { build_id: null },
      data: { build_id: defaultBuild.id },
    });
  }
}
