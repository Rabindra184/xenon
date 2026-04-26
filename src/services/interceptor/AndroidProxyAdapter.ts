import { IDevice } from '../../interfaces/IDevice';

export type CertInstallMode = 'system' | 'user';

interface AdbLike {
  adbExec(args: string[], opts?: any): Promise<any>;
}

export type AdbProvider = (udid: string) => Promise<AdbLike>;

export class AndroidProxyAdapter {
  constructor(private readonly getAdb: AdbProvider) {}

  static selectInstallMode(device: Pick<IDevice, 'deviceType' | 'realDevice'>): CertInstallMode {
    return device.deviceType === 'emulator' ? 'system' : 'user';
  }

  async setProxy(udid: string, host: string, port: number): Promise<void> {
    const adb = await this.getAdb(udid);
    await adb.adbExec([
      '-s',
      udid,
      'shell',
      'settings',
      'put',
      'global',
      'http_proxy',
      `${host}:${port}`,
    ]);
  }

  async clearProxy(udid: string): Promise<void> {
    const adb = await this.getAdb(udid);
    await adb.adbExec(['-s', udid, 'shell', 'settings', 'put', 'global', 'http_proxy', ':0']);
  }

  // Forwards a port on the device back to a port on the host over the adb transport
  // (USB or wireless adb). The device sees `127.0.0.1:devicePort` and that traffic
  // reaches the host's `hostPort`. This is the standard way to make a host-side
  // proxy reachable from a real device when host and device are not on the same LAN
  // (CI runners, hotel WiFi, NAT'd hosts, USB-only setups).
  async addReverse(udid: string, devicePort: number, hostPort: number): Promise<void> {
    const adb = await this.getAdb(udid);
    await adb.adbExec(['-s', udid, 'reverse', `tcp:${devicePort}`, `tcp:${hostPort}`]);
  }

  async removeReverse(udid: string, devicePort: number): Promise<void> {
    const adb = await this.getAdb(udid);
    await adb.adbExec(['-s', udid, 'reverse', '--remove', `tcp:${devicePort}`]);
  }

  async installCaCert(
    udid: string,
    localCertPath: string,
    androidFilename: string,
    mode: CertInstallMode,
  ): Promise<void> {
    const adb = await this.getAdb(udid);
    if (mode === 'system') {
      await adb.adbExec(['-s', udid, 'root']);
      await adb.adbExec(['-s', udid, 'wait-for-device']);
      await adb.adbExec(['-s', udid, 'remount']);
      await adb.adbExec([
        '-s',
        udid,
        'push',
        localCertPath,
        `/system/etc/security/cacerts/${androidFilename}`,
      ]);
      await adb.adbExec([
        '-s',
        udid,
        'shell',
        'chmod',
        '644',
        `/system/etc/security/cacerts/${androidFilename}`,
      ]);
    } else {
      await adb.adbExec(['-s', udid, 'push', localCertPath, `/sdcard/${androidFilename}`]);
    }
  }
}
