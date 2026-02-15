import { DeviceStoreFactory } from './device-store';
import { PrismaService } from './prisma-service';
import { IDeviceStore, IPendingSessionStore } from './device-store.interface';
import log from '../logger';
import { Service, Container } from 'typedi';

export interface QueueStatus {
  position: number;
  totalInQueue: number;
  etaInMs: number;
  platform: string;
  matchedDevicesCount: number;
  availableDevicesCount: number;
}

@Service()
export class QueueService {
  private deviceStore: IDeviceStore = DeviceStoreFactory.getStore();
  private pendingStore: IPendingSessionStore = DeviceStoreFactory.getPendingSessionStore();

  constructor(private prisma: PrismaService) {}

  /**
   * Calculates the average session duration for a platform in milliseconds
   * Defaults to 5 minutes (300,000 ms) if no history exists
   */
  private async getAverageSessionDuration(platform: string): Promise<number> {
    try {
      const recentSessions = await this.prisma.session.findMany({
        where: {
          device_platform: platform.toLowerCase(),
          endTime: { not: null },
        },
        orderBy: {
          endTime: 'desc',
        },
        take: 20,
        select: {
          startTime: true,
          endTime: true,
        },
      });

      if (recentSessions.length === 0) {
        return 300000; // 5 minutes default
      }

      const totalDuration = recentSessions.reduce((acc: number, session: any) => {
        const duration = session.endTime!.getTime() - session.startTime.getTime();
        return acc + duration;
      }, 0);

      return Math.floor(totalDuration / recentSessions.length);
    } catch (e) {
      log.error(`Error calculating average session duration: ${e}`);
      return 300000;
    }
  }

  /**
   * Returns queue status for a specific pending capability
   */
  async getQueueStatus(capabilityId: string): Promise<QueueStatus | null> {
    log.info(`[QueueService] Fetching queue status for capability ID: ${capabilityId}`);
    const allPending = await this.pendingStore.getAllPendingSessions();
    const sortedPending = allPending.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    const index = sortedPending.findIndex((s) => s.capability_id === capabilityId);
    if (index === -1) return null;

    const request = sortedPending[index];
    const platform = (
      request.alwaysMatch?.platformName ||
      request.platformName ||
      'any'
    ).toLowerCase();

    // Find devices that could potentially handle this request
    const allDevices = await this.deviceStore.getAllDevices();
    const matchedDevices = allDevices.filter(
      (d) => platform === 'any' || d.platform.toLowerCase() === platform,
    );

    const availableDevices = matchedDevices.filter((d) => !d.busy && !d.userBlocked && !d.offline);

    // Position in terms of platform-specific queue
    const platformSortedPending = sortedPending.filter((s) => {
      const sPlatform = (s.alwaysMatch?.platformName || s.platformName || 'any').toLowerCase();
      return platform === 'any' || sPlatform === platform || sPlatform === 'any';
    });

    const platformIndex = platformSortedPending.findIndex((s) => s.capability_id === capabilityId);
    const position = platformIndex + 1;

    // ETA Calculation:
    // We assume devices are occupied and will become free at a rate determined by AvgDuration.
    const avgDuration = await this.getAverageSessionDuration(platform);

    // Simple heuristic: Wait time = (Position / Matched Devices) * AvgDuration
    // If we have 10 devices and user is #10, wait time is ~AvgDuration / 10 if all were busy.
    // However, if some are free, wait time is 0.
    // For simplicity when queued: (Position / Max(1, MatchedDevices)) * AvgDuration
    const matchedCount = Math.max(1, matchedDevices.length);
    const etaInMs =
      availableDevices.length > 0 && position === 1
        ? 0
        : Math.floor((position / matchedCount) * avgDuration);

    return {
      position,
      totalInQueue: platformSortedPending.length,
      etaInMs,
      platform,
      matchedDevicesCount: matchedDevices.length,
      availableDevicesCount: availableDevices.length,
    };
  }

  /**
   * Returns a high-level summary of the entire queue
   */
  async getQueueSummary() {
    log.info('[QueueService] Calculating global queue summary');
    const allPending = await this.pendingStore.getAllPendingSessions();
    const platforms = [
      ...new Set(
        allPending.map((s) =>
          (s.alwaysMatch?.platformName || s.platformName || 'any').toLowerCase(),
        ),
      ),
    ];

    const summary: any = {
      total: allPending.length,
      byPlatform: {},
    };

    for (const p of platforms) {
      const pPending = allPending.filter(
        (s) => (s.alwaysMatch?.platformName || s.platformName || 'any').toLowerCase() === p,
      );
      const avgDuration = await this.getAverageSessionDuration(p);
      summary.byPlatform[p] = {
        count: pPending.length,
        avgDurationMs: avgDuration,
      };
    }

    return summary;
  }
}
