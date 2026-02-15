import { Service } from 'typedi';
import log from '../logger';
import os from 'os';

export type IsolationProfile = 'Economy' | 'Performance' | 'Guaranteed';

/**
 * ResourceIsolationService
 * Provides abstraction for OS-level process sandboxing and priority management.
 * Prevents "Noisy Neighbor" issues in high-density device farms.
 */
@Service()
export class ResourceIsolationService {
  private isMac: boolean;
  private isLinux: boolean;

  constructor() {
    this.isMac = os.platform() === 'darwin';
    this.isLinux = os.platform() === 'linux';
  }

  /**
   * Wraps a command string with OS-level isolation/priority prefixes.
   * @param command The base command to execute
   * @param profile The desired isolation profile
   * @returns The wrapped command
   */
  public wrapCommand(command: string, profile: IsolationProfile): string {
    if (profile === 'Performance') return command; // Default, no wrap needed

    if (this.isMac) {
      return this.wrapMacOS(command, profile);
    }

    if (this.isLinux) {
      return this.wrapLinux(command, profile);
    }

    return command;
  }

  /**
   * Specialized wrapper for child_process.spawn
   */
  public wrapSpawn(
    command: string,
    args: string[],
    profile: IsolationProfile,
  ): { command: string; args: string[] } {
    if (profile === 'Performance') return { command, args };

    if (this.isMac) {
      if (profile === 'Economy') {
        return { command: 'taskpolicy', args: ['-c', 'background', command, ...args] };
      }
      if (profile === 'Guaranteed') {
        return { command: 'nice', args: ['-n', '-5', command, ...args] };
      }
    }

    if (this.isLinux) {
      if (profile === 'Economy') {
        return { command: 'nice', args: ['-n', '19', command, ...args] };
      }
      if (profile === 'Guaranteed') {
        return { command: 'nice', args: ['-n', '-10', command, ...args] };
      }
    }

    return { command, args };
  }

  /**
   * macOS version using taskpolicy
   * -c background: Moves process to background throttled state
   * -p <pid>: Can also be used, but we wrap the spawn.
   */
  private wrapMacOS(command: string, profile: IsolationProfile): string {
    if (profile === 'Economy') {
      // taskpolicy -c background is the most effective way to throttle CPU/IO on Mac
      log.debug(`🛡️ Resource Isolation: Throttling command to background (Economy)`);
      return `taskpolicy -c background ${command}`;
    }

    if (profile === 'Guaranteed') {
      // MacOS doesn't have a simple "High priority" CLI wrapper for spawn easily
      // without sudo, but we can use 'nice'
      log.debug(`🛡️ Resource Isolation: Assigning high priority (Guaranteed)`);
      return `nice -n -5 ${command}`;
    }

    return command;
  }

  /**
   * Linux version using nice/renice
   * Priority -20 (Highest) to 19 (Lowest)
   */
  private wrapLinux(command: string, profile: IsolationProfile): string {
    if (profile === 'Economy') {
      log.debug(`🛡️ Resource Isolation: Throttling command (Economy)`);
      return `nice -n 19 ${command}`;
    }

    if (profile === 'Guaranteed') {
      log.debug(`🛡️ Resource Isolation: Assigning high priority (Guaranteed)`);
      return `nice -n -10 ${command}`;
    }

    return command;
  }

  /**
   * Get numeric priority value for libraries that support it
   */
  public getPriority(profile: IsolationProfile): number {
    switch (profile) {
      case 'Economy':
        return 19;
      case 'Guaranteed':
        return -10;
      default:
        return 0;
    }
  }
}
