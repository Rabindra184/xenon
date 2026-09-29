import AndroidDeviceManager from '../device-managers/AndroidDeviceManager';
import log from '../logger';
import { exec } from 'teen_process';
import SessionType from '../enums/SessionType';
import type { AxiosRequestConfig } from 'axios';
import { HealthErrorType, SessionHealthResult, XenonSessionOptions } from './XenonSession';
import { RemoteSession } from './RemoteSession';
import { Container } from 'typedi';
import { XenonManager } from '../device-managers';
import { XENON_CAPABILITIES } from '../XenonCapabilityManager';
import { VideoPipelineService } from '../services/VideoPipelineService';
import AndroidStreamService from '../device-managers/android/AndroidStreamService';
import IOSStreamService from '../device-managers/ios/IOSStreamService';
import { internalCallBaseUrl, internalCallHeaders } from '../gateway/internalCall';

export type LocalSessionOptions = XenonSessionOptions & {
  driver: any;
};

export class LocalSession extends RemoteSession {
  protected driver: any;

  constructor(options: LocalSessionOptions) {
    const { address, port, basePath } = options.driver.opts || options.driver;
    // The inherited HTTP calls loop back to this server's own
    // `<basePath>/wd-internal`, which the session gateway accepts only with
    // this process's secret (gateway/internalCall.ts).
    super({ ...options, baseUrl: internalCallBaseUrl(address, port, basePath) });
    this.driver = options.driver;
  }

  /**
   * A loopback call carries the per-process secret, and never goes through an
   * HTTP proxy from the environment, which would receive the secret.
   */
  protected async callOptions(): Promise<AxiosRequestConfig> {
    return { headers: internalCallHeaders(), proxy: false };
  }

  /**
   * Whether Appium still has this session, asked of the in-process driver.
   *
   * Not an HTTP probe: any command sent to the session, `timeouts` included,
   * restarts the driver's new-command timeout and Xenon's own idle clock, so a
   * heartbeat every 30 s would keep a session its client abandoned (and its
   * phone) alive for ever. The umbrella drops a session from its map when it
   * is deleted, times out, or its driver shuts down unexpectedly.
   */
  async checkHealth(): Promise<SessionHealthResult> {
    if (!this.sessionId) {
      return {
        isHealthy: false,
        errorType: HealthErrorType.NONE,
        message: 'No session ID assigned',
      };
    }
    const umbrella = this.driver;
    const exists =
      typeof umbrella?.sessionExists === 'function'
        ? !!umbrella.sessionExists(this.sessionId)
        : !!umbrella?.sessions?.[this.sessionId];
    if (exists) return { isHealthy: true, errorType: HealthErrorType.NONE };
    return {
      isHealthy: false,
      errorType: HealthErrorType.SESSION_NOT_FOUND,
      message: 'Appium no longer has this session',
      statusCode: 404,
    };
  }

  /**
   * A local session's driver is in this process, so ask it directly instead of
   * looping back over HTTP. The loopback works, but it re-enters the Appium
   * route chain and therefore the plugin, posting a phantom `getPageSource`
   * into the session's own command log for a read the user never issued.
   *
   * Falls back to the inherited HTTP call, which is what a driver that does
   * not expose the method in-process (or one that throws) needs.
   */
  async getPageSource(): Promise<string> {
    const sessionDriver =
      this.driver?.sessions?.[this.sessionId]?.proxydriver ||
      this.driver?.sessions?.[this.sessionId];
    const targetDriver = sessionDriver || this.driver;

    if (targetDriver && typeof targetDriver.getPageSource === 'function') {
      try {
        const source = await targetDriver.getPageSource();
        if (source) return source;
        log.warn(
          `[LocalSession] In-process getPageSource returned nothing for ${this.sessionId}; retrying over HTTP.`,
        );
      } catch (err: any) {
        log.warn(
          `[LocalSession] In-process getPageSource failed for ${this.sessionId}: ${err.message}. Retrying over HTTP.`,
        );
      }
    }

    return super.getPageSource();
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

    const isolationService = Container.get(
      (await import('../services/ResourceIsolationService')).ResourceIsolationService,
    );
    const isolationProfile =
      (this.getCapabilities() as any)[XENON_CAPABILITIES.ISOLATION_PROFILE] || 'Performance';
    const videoPipeline = Container.get(VideoPipelineService);

    try {
      // Intelligent Video Pipeline: Hardware Accelerated & Zero-Copy
      log.info(`[LocalSession] Triggering Intelligent Video Pipeline for ${this.sessionId}`);

      // 1. Ensure MJPEG Stream is active for the device
      let mjpegPort: number | undefined;
      if (device.platform === 'android') {
        const result = await Container.get(AndroidStreamService).startStream(device.udid);
        mjpegPort = result.mjpegPort;
      } else if (device.platform === 'ios') {
        const result = await Container.get(IOSStreamService).startStream(device.udid);
        mjpegPort = result.mjpegPort;
      }

      // 2. Start HW-Accelerated Recording
      await videoPipeline.startRecording({
        sessionId: this.sessionId,
        udid: device.udid,
        resolution,
        mjpegPort,
      });
    } catch (err: any) {
      log.warn('[LocalSession] Failed to start Intelligent Video Pipeline:', err);
    }
  }

  isVideoRecordingInProgress(): boolean {
    return Container.get(VideoPipelineService).isRecording(this.sessionId);
  }

  // The in-process pipeline or driver first; the loopback call last.
  async stopVideoRecording(driver?: any): Promise<string | null> {
    const videoPipeline = Container.get(VideoPipelineService);
    if (videoPipeline.isRecording(this.sessionId)) {
      try {
        log.info(`[LocalSession] Stopping Intelligent Video Pipeline for ${this.sessionId}`);
        return await videoPipeline.stopRecording(this.sessionId);
      } catch (err: any) {
        log.warn('[LocalSession] Failed to stop Intelligent Video Pipeline:', err);
      }
    }

    const targetDriver = driver || this.driver;
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

    // Over HTTP to this server's own /wd-internal, with the secret: the public
    // session path would need the owner's credentials under per-command auth.
    return await super.stopVideoRecording();
  }

  getLiveVideoUrl() {
    const { address } = this.driver.opts || this.driver;
    const safeAddress = address === '0.0.0.0' ? '127.0.0.1' : address;

    // First, check the session capability (standard Appium flow)
    let mjpegServerPort = this.getCapabilities()['mjpegServerPort'];

    // Fallback: For Artisan WDA flow (go-ios), the mjpegServerPort is on the device object
    // because we delete the capability to avoid Appium/WDA conflicts
    if (!mjpegServerPort || isNaN(mjpegServerPort)) {
      const device = this.getDevice();
      mjpegServerPort = device?.mjpegServerPort;
    }

    if (mjpegServerPort && !isNaN(mjpegServerPort)) {
      return `http://${safeAddress}:${mjpegServerPort}`;
    } else {
      return null;
    }
  }
}
