import { Container } from 'typedi';
import type { AdbProvider } from '../interceptor/AndroidProxyAdapter';

/**
 * A phone's adb as the rest of Xenon reaches it: appium-adb's, which finds the
 * binary through ANDROID_HOME / ANDROID_SDK_ROOT and runs it without a shell,
 * and which talks to a remote adb server for a phone that has one. Never a
 * bare `adb`: a server started without the SDK on its PATH (Xenon Control, a
 * service) has none.
 *
 * Imported lazily: AndroidDeviceManager pulls in most of the device layer.
 */
export const adbForPhone: AdbProvider = async (udid: string) => {
  const { default: AndroidDeviceManager } =
    await import('../../device-managers/AndroidDeviceManager');
  return await Container.get(AndroidDeviceManager).getAdbForDevice(udid);
};
