import usbmux from 'usbmux';
import { Service } from 'typedi';
import log from '../logger';
import { isUsbmuxdUnavailable, usbmuxdNotice } from './ios/usbmuxd';

@Service()
export class IosTracker {
  private listener: any;
  private log = log.scope('IOSTracker');

  constructor() {
    this.listener = usbmux.createListener();
    // The listener is a raw socket to usbmuxd. Without an 'error' listener a
    // failed connect (no usbmuxd on this machine) is thrown as an uncaught
    // exception, and Xenon's handler then ends the whole process.
    this.listener.on('error', (err: unknown) => {
      if (isUsbmuxdUnavailable(err)) usbmuxdNotice(this.log, err);
      else
        this.log.error(`iPhone attach/detach tracking failed: ${(err as Error)?.message ?? err}`);
    });
  }

  public getListener(): any {
    return this.listener;
  }

  async stop() {
    this.listener.end();
  }
}
