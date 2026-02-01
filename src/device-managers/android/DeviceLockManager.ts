import AsyncLock from 'async-lock';

class DeviceLockManager {
  private static instance: DeviceLockManager;
  private lock: AsyncLock;

  private constructor() {
    this.lock = new AsyncLock();
  }

  public static getInstance(): DeviceLockManager {
    if (!DeviceLockManager.instance) {
      DeviceLockManager.instance = new DeviceLockManager();
    }
    return DeviceLockManager.instance;
  }

  public async acquire(udid: string, fn: () => Promise<any>): Promise<any> {
    return await this.lock.acquire(udid, fn);
  }

  public isLocked(udid: string): boolean {
    return this.lock.isBusy(udid);
  }
}

export const deviceLock = DeviceLockManager.getInstance();
