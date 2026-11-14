import type { AdbProvider } from '../interceptor/AndroidProxyAdapter';

/** Whether Wi-Fi and mobile data were on; null when the phone couldn't say. */
export interface RadioState {
  wifiOn: boolean | null;
  dataOn: boolean | null;
}

/**
 * A phone's Wi-Fi and mobile data, through the resolved adb (`adbExec`: no
 * shell, no bare `adb`).
 */
export class AndroidRadios {
  constructor(private readonly getAdb: AdbProvider) {}

  /**
   * `wifi_on` is 1 or 2 when Wi-Fi is on (2: on in spite of airplane mode),
   * 0 or 3 when it is off. `mobile_data` is 1 or 0. Anything else, or a read
   * that fails, is null: "don't know".
   */
  async read(udid: string): Promise<RadioState> {
    const adb = await this.getAdb(udid);
    const get = async (name: string): Promise<string | null> => {
      try {
        const out = await adb.adbExec(['-s', udid, 'shell', 'settings', 'get', 'global', name]);
        return String(out ?? '').trim();
      } catch {
        return null;
      }
    };
    const wifi = await get('wifi_on');
    const data = await get('mobile_data');
    return {
      wifiOn: wifi === '1' || wifi === '2' ? true : wifi === '0' || wifi === '3' ? false : null,
      dataOn: data === '1' ? true : data === '0' ? false : null,
    };
  }

  /** Mobile data, then Wi-Fi, off; or only the ones asked for. */
  async turnOff(
    udid: string,
    which: { data: boolean; wifi: boolean } = { data: true, wifi: true },
  ): Promise<void> {
    if (!which.data && !which.wifi) return;
    const adb = await this.getAdb(udid);
    if (which.data) await adb.adbExec(['-s', udid, 'shell', 'svc', 'data', 'disable']);
    if (which.wifi) await adb.adbExec(['-s', udid, 'shell', 'svc', 'wifi', 'disable']);
  }

  /** Turns on the ones asked for; leaves the others as they are. */
  async turnOn(udid: string, which: { data: boolean; wifi: boolean }): Promise<void> {
    if (!which.data && !which.wifi) return;
    const adb = await this.getAdb(udid);
    if (which.data) await adb.adbExec(['-s', udid, 'shell', 'svc', 'data', 'enable']);
    if (which.wifi) await adb.adbExec(['-s', udid, 'shell', 'svc', 'wifi', 'enable']);
  }

  /** What to turn back on after Offline: what was on, and what nobody knew about. */
  static toRestore(prior: RadioState): { data: boolean; wifi: boolean } {
    return { data: prior.dataOn !== false, wifi: prior.wifiOn !== false };
  }

  /** What Normal turns on: what isn't known to be on. */
  static toTurnOn(now: RadioState): { data: boolean; wifi: boolean } {
    return { data: now.dataOn !== true, wifi: now.wifiOn !== true };
  }

  /** What to turn back off after Normal: only what was known to be off. */
  static toTurnOffAgain(prior: RadioState): { data: boolean; wifi: boolean } {
    return { data: prior.dataOn === false, wifi: prior.wifiOn === false };
  }
}
