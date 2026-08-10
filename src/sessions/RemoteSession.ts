import axios from 'axios';
import log from '../logger';
import SessionType from '../enums/SessionType';
import {
  HealthErrorType,
  SessionHealthResult,
  XenonSession,
  XenonSessionOptions,
} from './XenonSession';

export type RemoteSessionOptions = XenonSessionOptions & {
  baseUrl: any;
};

export class RemoteSession extends XenonSession {
  private isVideoAvailable = false;
  private baseUrl: string;

  constructor(options: RemoteSessionOptions) {
    super(options);
    this.baseUrl = options.baseUrl;
  }

  isVideoRecordingInProgress(): boolean {
    return this.isVideoAvailable;
  }

  getType(): SessionType {
    return SessionType.REMOTE;
  }

  getScreenShot(): Promise<string> {
    return axios({
      method: 'get',
      url: `${this.baseUrl}/session/${this.sessionId}/screenshot`,
    }).then((response) => (response.data ? response.data.value : ''));
  }

  async getPageSource(): Promise<string> {
    // Generous timeout on purpose: serialising a deep hierarchy on a slow
    // real device is seconds, not milliseconds, and a truncated read here
    // reads to the caller as "this screen has no elements".
    const response = await axios({
      method: 'get',
      url: `${this.baseUrl}/session/${this.sessionId}/source`,
      timeout: 60000,
    });
    return response?.data?.value || '';
  }

  async stopVideoRecording(_driver?: any) {
    log.info(
      `[RemoteSession] stopVideoRecording called for session ${this.sessionId}. isVideoAvailable: ${this.isVideoAvailable}`,
    );
    try {
      const response = await axios({
        method: 'post',
        url: `${this.baseUrl}/session/${this.sessionId}/appium/stop_recording_screen`,
        data: {},
      });
      const dataLen = response?.data?.value?.length || 0;
      log.info(
        `[RemoteSession] stopVideoRecording response status: ${response.status}, data length: ${dataLen}`,
      );
      return response.status === 200 && response?.data?.value ? response?.data?.value : '';
    } catch (err: any) {
      log.warn(
        `[RemoteSession] stopVideoRecording error: ${err.message}, trying anyway to retrieve video...`,
      );
      // Even if there's an error, try to get the video data
      try {
        const retryResponse = await axios({
          method: 'post',
          url: `${this.baseUrl}/session/${this.sessionId}/appium/stop_recording_screen`,
          data: {},
        });
        const retryDataLen = retryResponse?.data?.value?.length || 0;
        log.info(
          `[RemoteSession] stopVideoRecording retry succeeded, data length: ${retryDataLen}`,
        );
        return retryResponse?.data?.value || '';
      } catch (retryErr: any) {
        log.error(`[RemoteSession] stopVideoRecording retry also failed: ${retryErr.message}`);
        return '';
      }
    }
  }

  async stopPerformanceRecording(): Promise<string | null> {
    log.info(`[RemoteSession] stopPerformanceRecording called for session ${this.sessionId}`);
    try {
      const response = await axios({
        method: 'post',
        url: `${this.baseUrl}/session/${this.sessionId}/execute/sync`,
        data: {
          script: 'mobile: stopPerfRecord',
          args: [
            {
              profileName: 'Time Profiler',
            },
          ],
        },
      });
      return response.status === 200 && response?.data?.value ? response?.data?.value : null;
    } catch (err: any) {
      log.warn(`[RemoteSession] stopPerformanceRecording failed: ${err.message}`);
      return null;
    }
  }

  async startPerformanceRecording(): Promise<void> {
    log.info(`[RemoteSession] startPerformanceRecording called for session ${this.sessionId}`);
    try {
      await axios({
        method: 'post',
        url: `${this.baseUrl}/session/${this.sessionId}/execute/sync`,
        data: {
          script: 'mobile: startPerfRecord',
          args: [
            {
              profileName: 'Time Profiler',
              timeout: 1800000, // 30 mins
            },
          ],
        },
      });
    } catch (err: any) {
      log.warn(`[RemoteSession] startPerformanceRecording failed: ${err.message}`);
    }
  }

  async startVideoRecording(options?: { resolution?: string }, _driver?: any) {
    const device = this.getDevice();
    let resolution = options?.resolution ? options.resolution.replace('x', ':') : undefined;
    let size = options?.resolution ? options.resolution.replace(':', 'x') : undefined;

    // Principal Intelligence: Auto-detect orientation based on device dimensions
    // to prevent squashed/stretched videos.
    if (!resolution && device.screenWidth && device.screenHeight) {
      const w = parseInt(device.screenWidth);
      const h = parseInt(device.screenHeight);
      log.info(
        `[RemoteSession] Auto-detected device dimensions: ${w}x${h} for session ${this.sessionId}`,
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
      // Fallback: Default to portrait 720p if dimensions unknown, as most mobile tests are portrait
      resolution = '720:1280';
      size = '720x1280';
    }

    log.info(`[RemoteSession] Starting recording with resolution: ${resolution}, size: ${size}`);

    return axios({
      method: 'post',
      url: `${this.baseUrl}/session/${this.sessionId}/appium/start_recording_screen`,
      data: {
        options: {
          videoType: 'libx264',
          videoFps: 10,
          /* Force video scale to ensure width/height are divisible by 2 (ffmpeg requirement) */
          videoScale: resolution,
          videoSize: size,
          timeLimit: 1800, // 30 min
        },
      },
    })
      .then((response) => {
        // Set flag to true if response is successful (status 200 or 2xx)
        this.isVideoAvailable = response.status >= 200 && response.status < 300;
        const status = response.status;
        log.info(
          `[RemoteSession] startVideoRecording response status: ${status}, isVideoAvailable: ${this.isVideoAvailable}`,
        );
      })
      .catch((error) => {
        log.error('[RemoteSession] startVideoRecording error:', error.message);
        this.isVideoAvailable = false;
        throw error;
      });
  }

  getLiveVideoUrl(): string | null {
    const url = new URL(this.baseUrl);
    const capabilities = this.getCapabilities();
    if (capabilities['mjpegServerPort'] && !isNaN(capabilities['mjpegServerPort'])) {
      return `${url.origin}/xenon/api/session/${this.sessionId}/live_video`;
    } else {
      return null;
    }
  }

  async checkHealth(): Promise<SessionHealthResult> {
    if (!this.sessionId) {
      return {
        isHealthy: false,
        errorType: HealthErrorType.NONE,
        message: 'No session ID assigned',
      };
    }

    // Identify the root Appium URL (strip /wd-internal if present)
    const appiumUrl = this.baseUrl.replace(/\/wd-internal$/, '');

    try {
      // 1️⃣ Safe, read-only, lightweight probe: GET /session/{id}/timeouts
      // This is a W3C standard command that all Appium drivers should register.
      const response = await axios({
        method: 'get',
        url: `${this.baseUrl}/session/${this.sessionId}/timeouts`,
        timeout: 5000,
      });

      return {
        isHealthy: response.status >= 200 && response.status < 300,
        errorType: HealthErrorType.NONE,
        statusCode: response.status,
      };
    } catch (err: any) {
      const status = err.response?.status;
      const message = err.message || 'Unknown error';
      const errorData = err.response?.data?.value || err.response?.data;
      const errorJson = JSON.stringify(errorData || {}).toLowerCase();

      // 2️⃣ Failure Classification & Fallback Logic
      if (status === 404) {
        // Distinguish between "Session Not Found" and "Command Not Found"
        // Appium 2 returns "No route found" or "unknown command" for unsupported endpoints.
        const isUnsupported =
          errorJson.includes('unknown command') || errorJson.includes('no route found');
        const isInvalidSession = errorJson.includes('invalid session id');

        if (isUnsupported) {
          log.info(
            '[RemoteSession] Probe endpoint unsupported on this driver, but driver is responsive. Classifying as HEALTHY.',
          );
          return {
            isHealthy: true,
            errorType: HealthErrorType.UNSUPPORTED_ENDPOINT,
            message: 'Probe endpoint unsupported but driver is alive',
          };
        }

        if (isInvalidSession) {
          log.error(
            `[RemoteSession] Session ${this.sessionId} definitively GONE (Invalid Session ID).`,
          );
          return {
            isHealthy: false,
            errorType: HealthErrorType.SESSION_NOT_FOUND,
            message: 'Invalid Session ID',
            statusCode: 404,
          };
        }

        log.warn(
          `[RemoteSession] Session ${this.sessionId} probe returned 404. Performing server status fallback...`,
        );

        // Fallback: Verify Appium server is alive
        try {
          const statusRes = await axios.get(`${appiumUrl}/status`, { timeout: 3000 });
          if (statusRes.status === 200) {
            // If server is alive but we got a raw 404 with no specific error,
            // it's likely the session is gone in Appium 2 (where /sessions list check is unsupported).
            return {
              isHealthy: false,
              errorType: HealthErrorType.SESSION_NOT_FOUND,
              message: 'Session likely gone (Server alive but 404 on session path)',
              statusCode: 404,
            };
          }
        } catch (serverErr: any) {
          log.error(`[RemoteSession] Appium server REACHABILITY FAILED: ${serverErr.message}`);
          return {
            isHealthy: false,
            errorType: HealthErrorType.SERVER_UNREACHABLE,
            message: `Server unreachable: ${serverErr.message}`,
          };
        }
      }

      if (status >= 500) {
        return {
          isHealthy: false,
          errorType: HealthErrorType.DRIVER_ERROR,
          message: `Driver internal error: ${message}`,
          statusCode: status,
        };
      }

      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        return {
          isHealthy: false,
          errorType: HealthErrorType.SERVER_UNREACHABLE,
          message: `Connection failed: ${err.code}`,
        };
      }

      return {
        isHealthy: false,
        errorType: HealthErrorType.TIMEOUT,
        message: `Probe timed out: ${message}`,
      };
    }
  }
}
