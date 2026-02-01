import axios from 'axios';
import log from '../logger';
import SessionType from '../enums/SessionType';
import { XenonSession, XenonSessionOptions } from './XenonSession';

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

  async stopVideoRecording(_driver?: any) {
    console.log(
      `[RemoteSession] stopVideoRecording called. isVideoAvailable: ${this.isVideoAvailable}`,
    );
    try {
      const response = await axios({
        method: 'post',
        url: `${this.baseUrl}/session/${this.sessionId}/appium/stop_recording_screen`,
        data: {},
      });
      console.log(
        `[RemoteSession] stopVideoRecording response status: ${response.status}, data length: ${
          response?.data?.value?.length || 0
        }`,
      );
      return response.status === 200 && response?.data?.value ? response?.data?.value : '';
    } catch (err: any) {
      console.log(
        `[RemoteSession] stopVideoRecording error: ${err.message}, trying anyway to retrieve video...`,
      );
      // Even if there's an error, try to get the video data
      try {
        const retryResponse = await axios({
          method: 'post',
          url: `${this.baseUrl}/session/${this.sessionId}/appium/stop_recording_screen`,
          data: {},
        });
        console.log(
          `[RemoteSession] stopVideoRecording retry succeeded, data length: ${
            retryResponse?.data?.value?.length || 0
          }`,
        );
        return retryResponse?.data?.value || '';
      } catch (retryErr: any) {
        console.log(`[RemoteSession] stopVideoRecording retry also failed: ${retryErr.message}`);
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
        console.log(
          `[RemoteSession] startVideoRecording response status: ${response.status}, isVideoAvailable: ${this.isVideoAvailable}`,
        );
      })
      .catch((error) => {
        console.log('[RemoteSession] startVideoRecording error:', error.message);
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
}
