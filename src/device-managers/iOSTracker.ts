import usbmux from 'usbmux';
import { Service } from 'typedi';
@Service()
export class IosTracker {
  private listener: any;

  constructor() {
    this.listener = new usbmux.createListener();
  }

  public getListener(): any {
    return this.listener;
  }

  async stop() {
    this.listener.end();
  }
}
