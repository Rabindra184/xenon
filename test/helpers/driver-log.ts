import { LineConsumingLog } from 'appium-xcuitest-driver/build/lib/device/log/line-consuming-log';

const quietLog = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * The XCUITest driver's own log class, as an iPhone's (`IOSDeviceLog`) and a
 * simulator's (`IOSSimulatorLog`) `logs.syslog` extend it, with `line()` in
 * place of a device: what Xenon reads is what the driver keeps.
 */
export class TestDriverLog extends LineConsumingLog {
  constructor() {
    super({ log: quietLog as any });
  }
  async startCapture(): Promise<void> {}
  async stopCapture(): Promise<void> {}
  get isCapturing(): boolean {
    return true;
  }
  /** A line from the device, as the driver's capture hands it on. */
  line(message: string): void {
    this.broadcast(message);
  }
}
