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
 * watch again within the grace (a reload, another tab), or while that check
 * runs, cancels it.
 */
export class LeaveScheduler {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * Bumped by every cancel (and so every leave), including while a check is
   * already running: the check compares it right before it stops anything.
   * Through 2.36 cancel only cleared the timer, so a stream/start landing
   * after the grace, while the check awaited the viewer count or the
   * recording lookup, had its stream stopped and its hold released by the
   * page that had left. One number per device the server has seen.
   */
  private epochs = new Map<string, number>();

  constructor(
    private deps: LeaveDeps,
    private graceMs = LEAVE_GRACE_MS,
  ) {}

  /** A page stopped watching `udid`. */
  leave(udid: string): void {
    this.cancel(udid);
    const epoch = this.epochOf(udid);
    const timer = setTimeout(() => {
      this.pending.delete(udid);
      void this.settle(udid, epoch);
    }, this.graceMs);
    this.pending.set(udid, timer);
  }

  /** Someone asked to watch `udid` again: keep its preview, even if its check is under way. */
  cancel(udid: string): void {
    this.epochs.set(udid, this.epochOf(udid) + 1);
    const timer = this.pending.get(udid);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.pending.delete(udid);
  }

  private epochOf(udid: string): number {
    return this.epochs.get(udid) ?? 0;
  }

  private async settle(udid: string, epoch: number): Promise<void> {
    try {
      const watching = await this.deps.viewers(udid);
      if (watching > 0) {
        log.info(`[${udid}] A viewer left; keeping the preview for ${watching} other viewer(s).`);
        return;
      }
      if (await this.deps.isRecording(udid)) return;
      if (this.epochOf(udid) !== epoch) {
        log.info(`[${udid}] Someone started watching again; keeping the preview.`);
        return;
      }
      await this.deps.stop(udid);
      log.info(`[${udid}] The last viewer left; preview stopped and hold released.`);
    } catch (e: any) {
      log.warn(`[${udid}] Could not settle a viewer leaving: ${e?.message ?? e}`);
    }
  }
}
