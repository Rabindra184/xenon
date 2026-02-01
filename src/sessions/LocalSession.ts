import SessionType from '../enums/SessionType';
import { XenonSessionOptions } from './XenonSession';
import { RemoteSession } from './RemoteSession';
import { Container } from 'typedi';
import { XenonManager } from '../device-managers';
import AndroidDeviceManager from '../device-managers/AndroidDeviceManager';
import log from '../logger';
import { exec } from 'teen_process';

function constructBasePath(path: string) {
  if (!path || path == '') {
    return '/wd-internal';
  }
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  if (path.endsWith('/')) {
    path = path.substr(0, path.length - 2);
  }
  return `${path}/wd-internal`;
}

export type LocalSessionOptions = XenonSessionOptions & {
  driver: any;
};

export class LocalSession extends RemoteSession {
  protected driver: any;
  private appiumBaseUrl: string;

  constructor(options: LocalSessionOptions) {
    const { address, port, basePath } = options.driver.opts || options.driver;
    super({
      ...options,
      baseUrl: `http://${address}:${port}${constructBasePath(basePath)}`,
    });
    this.driver = options.driver;
    // Store the proper Appium base URL for video recording commands.
    // Principal Intelligence: Map 0.0.0.0 to 127.0.0.1 for internal loopack safety.
    const safeAddress = address === '0.0.0.0' ? '127.0.0.1' : address;
    this.appiumBaseUrl = `http://${safeAddress}:${port}${basePath || ''}`;
  }

  async getScreenShot(): Promise<string> {
    const device = this.getDevice();
    const sessionId = this.sessionId;

    // Principal Intelligence: Always try to get the actual session driver (proxydriver) first.
    // The umbrella this.driver object may not have the getScreenshot method directly.
    const sessionDriver =
      this.driver.sessions?.[sessionId]?.proxydriver || this.driver.sessions?.[sessionId];
    const targetDriver = sessionDriver || this.driver;

    // --- Android Optimization: Direct ADB ---
    if (device.platform === 'android') {
      try {
        const deviceManager = Container.get(XenonManager);
        const androidManager = (await deviceManager.deviceInstances()).find(
          (m) => m instanceof AndroidDeviceManager,
        ) as AndroidDeviceManager;
        if (androidManager) {
          log.debug(`[LocalSession] Taking high-speed ADB screenshot for ${device.udid}`);
          const screenshot = await androidManager.getScreenshot(device.udid);
          if (screenshot) {
            log.debug(
              `[LocalSession] ADB screenshot for ${device.udid} (${screenshot.length} chars)`,
            );
            return screenshot;
          }
        }
      } catch (err: any) {
        log.warn(
          `[LocalSession] Direct ADB screenshot failed for ${device.udid}: ${err.message}. Falling back.`,
        );
      }
    }

    // --- iOS / Universal Path: Use Appium Driver ---
    // Try the specific session driver's getScreenshot first
    try {
      if (targetDriver && typeof targetDriver.getScreenshot === 'function') {
        log.debug(`[LocalSession] Using targetDriver.getScreenshot for ${device.udid}`);
        const screenshot = await targetDriver.getScreenshot();
        if (screenshot) {
          return screenshot;
        }
      }
    } catch (err: any) {
      log.warn(`[LocalSession] targetDriver.getScreenshot failed: ${err.message}`);
    }

    // Final Fallback: Use the helper function which calls the main driver object
    const { takeScreenshot } = await import('../helpers');
    const driverScreenshot = await takeScreenshot(this.driver);
    if (driverScreenshot) {
      log.info(`[LocalSession] Helper screenshot captured for ${device.udid}`);
      return driverScreenshot;
    }

    log.warn(`[LocalSession] All screenshot methods failed for ${device.udid}`);
    return '';
  }

  getType(): SessionType {
    return SessionType.LOCAL;
  }

  async stopPerformanceRecording(): Promise<string | null> {
    log.info(`[LocalSession] stopPerformanceRecording called for session ${this.sessionId}`);

    const sessionDriver =
      this.driver.sessions?.[this.sessionId]?.proxydriver || this.driver.sessions?.[this.sessionId];
    const targetDriver = sessionDriver || this.driver;

    try {
      if (targetDriver && typeof targetDriver.execute === 'function') {
        const result = await targetDriver.execute('mobile: stopPerfRecord', {
          profileName: 'Time Profiler',
        });
        return result || null;
      }
    } catch (err: any) {
      log.warn(`[LocalSession] Direct stopPerformanceRecording failed: ${err.message}.`);
    }

    return super.stopPerformanceRecording();
  }

  async startPerformanceRecording(): Promise<void> {
    log.info(`[LocalSession] startPerformanceRecording called for session ${this.sessionId}`);

    const sessionDriver =
      this.driver.sessions?.[this.sessionId]?.proxydriver || this.driver.sessions?.[this.sessionId];
    const targetDriver = sessionDriver || this.driver;

    try {
      if (targetDriver && typeof targetDriver.execute === 'function') {
        await targetDriver.execute('mobile: startPerfRecord', {
          profileName: 'Time Profiler',
          timeout: 1800000,
        });
        return;
      }
    } catch (err: any) {
      log.warn(`[LocalSession] Direct startPerformanceRecording failed: ${err.message}.`);
    }

    return super.startPerformanceRecording();
  }

  // Override to use proper Appium URL for video commands
  async startVideoRecording(options?: { resolution?: string }, driverOverride?: any) {
    log.info(`[LocalSession] Starting video recording for session ${this.sessionId}`);

    // Principal Intelligence: For local sessions, try to call the driver directly.
    // We try driverOverride first (e.g. from onUnexpectedShutdown), then search the session map, then this.driver.
    const sessionDriver =
      driverOverride ||
      this.driver.sessions?.[this.sessionId]?.proxydriver ||
      this.driver.sessions?.[this.sessionId];
    const targetDriver = sessionDriver || this.driver;

    const device = this.getDevice();
    let resolution = options?.resolution ? options.resolution.replace('x', ':') : undefined;
    let size = options?.resolution ? options.resolution.replace(':', 'x') : undefined;

    // Principal Intelligence: Auto-detect orientation based on device dimensions
    // to prevent squashed/stretched videos.
    if (!resolution && device.screenWidth && device.screenHeight) {
      const w = parseInt(device.screenWidth);
      const h = parseInt(device.screenHeight);
      log.info(
        `[LocalSession] Auto-detected device dimensions: ${w}x${h} for session ${this.sessionId}`,
      );
      if (h > w) {
        // Portrait device: Use vertical 720p equivalent
        resolution = '720:1280';
        size = '720x1280';
      } else {
        // Landscape device: Use standard 720p
        resolution = '1280:720';
        size = '1280x720';
      }
    } else if (!resolution) {
      // Fallback: Default to portrait 720p if dimensions unknown
      resolution = '720:1280';
      size = '720x1280';
    }

    try {
      if (targetDriver && typeof targetDriver.startRecordingScreen === 'function') {
        log.info(
          `[LocalSession] Using direct driver.startRecordingScreen for ${this.sessionId} with resolution ${resolution}`,
        );

        // Senior Resiliency: Pre-emptively try to clean up screenrecord via ADB ourselves.
        // If this succeeds, Appium's later internal killall might still fail,
        // but we've increased our chances of a clean slate.
        if (device.platform === 'android') {
          try {
            await exec(this.driver.opts?.adbExecutablePath || 'adb', [
              '-s',
              device.udid,
              'shell',
              'killall',
              '-2',
              'screenrecord',
            ]);
          } catch (e) {
            // Ignore killall failures
          }
        }

        try {
          await targetDriver.startRecordingScreen({
            videoType: 'libx264',
            videoFps: 10,
            videoScale: resolution,
            videoSize: size,
            timeLimit: 1800,
          });
        } catch (innerErr: any) {
          if (innerErr.message.includes('screenrecord')) {
            log.warn(
              `[LocalSession] Retrying startRecordingScreen without complex options for ${this.sessionId}`,
            );
            await targetDriver.startRecordingScreen({
              timeLimit: 1800,
            });
          } else {
            throw innerErr;
          }
        }

        // Manually update the flag in parent class logic
        (this as any).isVideoAvailable = true;
        return;
      }
    } catch (err: any) {
      log.warn(
        `[LocalSession] Direct startRecordingScreen failed: ${err.message}. Falling back to HTTP.`,
      );
    }

    const originalBaseUrl = (this as any).baseUrl;
    (this as any).baseUrl = this.appiumBaseUrl;
    try {
      return await super.startVideoRecording(options);
    } finally {
      (this as any).baseUrl = originalBaseUrl;
    }
  }

  // Override to use proper Appium URL for video commands
  async stopVideoRecording(driverOverride?: any) {
    log.info(`[LocalSession] Stopping video recording for session ${this.sessionId}`);

    // Principal Intelligence: Try direct driver call first.
    // Unpack actual driver if this.driver is the Appium umbrella driver.
    const sessionDriver =
      driverOverride ||
      this.driver.sessions?.[this.sessionId]?.proxydriver ||
      this.driver.sessions?.[this.sessionId];
    const targetDriver = sessionDriver || this.driver;

    try {
      if (targetDriver && typeof targetDriver.stopRecordingScreen === 'function') {
        log.info(`[LocalSession] Using direct driver.stopRecordingScreen for ${this.sessionId}`);
        const video = await targetDriver.stopRecordingScreen();
        if (video) {
          log.info(
            `[LocalSession] Successfully retrieved video directly from driver (${video.length} bytes)`,
          );
          return video;
        }
      } else {
        log.warn(
          `[LocalSession] Direct stopRecordingScreen not found on target driver. Function exists: ${
            typeof targetDriver?.stopRecordingScreen === 'function'
          }`,
        );
      }
    } catch (err: any) {
      log.warn(
        `[LocalSession] Direct stopRecordingScreen failed: ${err.message}. Falling back to HTTP.`,
      );
    }

    const originalBaseUrl = (this as any).baseUrl;
    (this as any).baseUrl = this.appiumBaseUrl;
    try {
      return await super.stopVideoRecording();
    } finally {
      (this as any).baseUrl = originalBaseUrl;
    }
  }

  getLiveVideoUrl() {
    const { address } = this.driver.opts || this.driver;
    const mjpegServerPort = this.getCapabilities()['mjpegServerPort'];
    if (mjpegServerPort && !isNaN(mjpegServerPort)) {
      return `http://${address}:${mjpegServerPort}`;
    } else {
      return null;
    }
  }
}
