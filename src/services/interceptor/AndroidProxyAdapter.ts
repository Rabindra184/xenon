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
