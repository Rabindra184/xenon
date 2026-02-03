import AsyncLock from 'async-lock';
import { Service, Container } from 'typedi';

@Service()
export class DeviceLockManager {
  private lock: AsyncLock;

  constructor() {
    this.lock = new AsyncLock();
  }

  public async acquire(udid: string, fn: () => Promise<any>): Promise<any> {
    return await this.lock.acquire(udid, fn);
  }

  public isLocked(udid: string): boolean {
    return this.lock.isBusy(udid);
  }
}

export const deviceLock = Container.get(DeviceLockManager);
