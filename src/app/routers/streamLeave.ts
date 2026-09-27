import log from '../../logger';

/**
 * How long a device's preview outlives the page that left it: long enough
 * for a reload to ask again, and for a closing tab's own connection to drop.
 */
export const LEAVE_GRACE_MS = 3000;

export interface LeaveDeps {
  /** Browser viewers still watching the device's preview, over any transport. */
  viewers(udid: string): Promise<number>;
  isRecording(udid: string): Promise<boolean>;
  /** Stop the device's preview and release its hold, as stream/stop does. */
  stop(udid: string): Promise<void>;
}

/**
 * Stops a device's preview when the last page watching it leaves.
 *
 * The live-preview hold belongs to the user and the device, not to one tab,
 * so a page that stops watching "leaves" rather than stopping outright:
 * stopping froze every other tab on the same device and released the phone
 * while they were still using it. After a short grace the device is stopped
 * only if nobody is watching and no recording reads it. Someone starting to
 * watch again within the grace (a reload, another tab) cancels it.
 */
export class LeaveScheduler {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private deps: LeaveDeps,
    private graceMs = LEAVE_GRACE_MS,
  ) {}

  /** A page stopped watching `udid`. */
  leave(udid: string): void {
    this.cancel(udid);
    const timer = setTimeout(() => {
      this.pending.delete(udid);
      void this.settle(udid);
    }, this.graceMs);
    this.pending.set(udid, timer);
  }

  /** Someone asked to watch `udid` again: keep its preview. */
  cancel(udid: string): void {
    const timer = this.pending.get(udid);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.pending.delete(udid);
  }

  private async settle(udid: string): Promise<void> {
    try {
      const watching = await this.deps.viewers(udid);
      if (watching > 0) {
        log.info(`[${udid}] A viewer left; keeping the preview for ${watching} other viewer(s).`);
        return;
      }
      if (await this.deps.isRecording(udid)) return;
      await this.deps.stop(udid);
      log.info(`[${udid}] The last viewer left; preview stopped and hold released.`);
    } catch (e: any) {
      log.warn(`[${udid}] Could not settle a viewer leaving: ${e?.message ?? e}`);
    }
  }
}
