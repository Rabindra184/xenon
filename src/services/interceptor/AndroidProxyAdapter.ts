import { IDevice } from '../../interfaces/IDevice';
import { isUnsetProxy } from '../network/xenonProxy';

export type CertInstallMode = 'system' | 'user';

interface AdbLike {
  adbExec(args: string[], opts?: any): Promise<any>;
}

export type AdbProvider = (udid: string) => Promise<AdbLike>;

/**
 * A CA certificate's file name as Android's store names it
 * (`<subject_hash_old>.<n>`). Checked before it goes into a device shell
 * command: a name read back from the ledger is data.
 */
export function isCaCertFileName(file: unknown): file is string {
  return typeof file === 'string' && /^[0-9A-Za-z_-]{1,64}\.[0-9]{1,3}$/.test(file);
}

/** Where a certificate of `mode` goes on the phone. */
export function caCertPath(mode: CertInstallMode, file: string): string {
  if (!isCaCertFileName(file)) throw new Error(`not a CA certificate file name: ${file}`);
  return mode === 'system' ? `/system/etc/security/cacerts/${file}` : `/sdcard/${file}`;
}

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

  /** The phone's global HTTP proxy as stored: `host:port`, or `null` / `:0` / '' for none. */
  async readProxy(udid: string): Promise<string> {
    const adb = await this.getAdb(udid);
    const out = await adb.adbExec(['-s', udid, 'shell', 'settings', 'get', 'global', 'http_proxy']);
    return String(out ?? '').trim();
  }

  /** Puts `previous` back as the phone's proxy, or clears it when there was none. */
  async restoreProxy(udid: string, previous: string | null): Promise<void> {
    if (previous === null || isUnsetProxy(previous)) return this.clearProxy(udid);
    const adb = await this.getAdb(udid);
    await adb.adbExec(['-s', udid, 'shell', 'settings', 'put', 'global', 'http_proxy', previous]);
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

  /**
   * Before an install: whether the certificate's file is already on the
   * phone, and, for the system store, whether adbd already runs as root
   * (`id -u` is 0). A read that fails counts as no.
   */
  async caCertState(
    udid: string,
    androidFilename: string,
    mode: CertInstallMode,
  ): Promise<{ present: boolean; root: boolean }> {
    const adb = await this.getAdb(udid);
    const target = caCertPath(mode, androidFilename);
    const read = async (args: string[]) => {
      try {
        return String((await adb.adbExec(['-s', udid, ...args])) ?? '').trim();
      } catch {
        return '';
      }
    };
    const present = (await read(['shell', 'ls', target])) === target;
    const root = mode === 'system' ? (await read(['shell', 'id', '-u'])) === '0' : false;
    return { present, root };
  }

  /**
   * `alreadyRoot`: adbd runs as root, so `adb root` (which restarts adbd) is
   * skipped.
   */
  async installCaCert(
    udid: string,
    localCertPath: string,
    androidFilename: string,
    mode: CertInstallMode,
    opts: { alreadyRoot?: boolean } = {},
  ): Promise<void> {
    const adb = await this.getAdb(udid);
    if (mode === 'system') {
      if (!opts.alreadyRoot) {
        await adb.adbExec(['-s', udid, 'root']);
        await adb.adbExec(['-s', udid, 'wait-for-device']);
      }
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

  /**
   * Takes the certificate off the phone. The system store needs adbd as root
   * and `/system` remounted, as the install did: both normally still hold
   * (root lasts until adbd restarts, the remount until the emulator reboots).
   * When adbd has lost root, `adb root` restarts adbd, which ends a running
   * session's UiAutomator2 instrumentation, its port forwards and a screen
   * recording: only with `mayRestartAdbd` (at this server's start, before any
   * session), else it throws and the record waits for the next start. Never
   * `adb unroot`, for the same reason: removal runs before the driver's own
   * delete.
   */
  async removeCaCert(
    udid: string,
    androidFilename: string,
    mode: CertInstallMode,
    opts: { mayRestartAdbd?: boolean } = {},
  ): Promise<void> {
    const target = caCertPath(mode, androidFilename);
    const adb = await this.getAdb(udid);
    if (mode === 'system') {
      let root = false;
      try {
        root = String((await adb.adbExec(['-s', udid, 'shell', 'id', '-u'])) ?? '').trim() === '0';
      } catch {
        root = false;
      }
      if (!root) {
        if (!opts.mayRestartAdbd) {
          throw new Error(
            "adbd isn't running as root, and turning it back on would restart adbd under a " +
              'running session',
          );
        }
        await adb.adbExec(['-s', udid, 'root']);
        await adb.adbExec(['-s', udid, 'wait-for-device']);
      }
      await adb.adbExec(['-s', udid, 'remount']);
    }
    await adb.adbExec(['-s', udid, 'shell', 'rm', '-f', target]);
  }
}
