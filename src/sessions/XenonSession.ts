import { XENON_CAPABILITIES } from '../XenonCapabilityManager';
import SessionType from '../enums/SessionType';
import { IDevice } from '../interfaces/IDevice';

export type XenonSessionOptions = {
  sessionId: string;
  xenonOption: Record<string, any>;
  device: IDevice;
  sessionResponse: Record<string, any>;
};

export enum SessionHealthState {
  HEALTHY = 'HEALTHY',     // 0 failures
  DEGRADED = 'DEGRADED',   // 1+ failures
  SUSPECT = 'SUSPECT',     // 3+ failures
  DEAD = 'DEAD',           // 6 failures or session verified gone
}

export enum HealthErrorType {
  NONE = 'NONE',
  UNSUPPORTED_ENDPOINT = 'UNSUPPORTED_ENDPOINT', // 404 on orientation but server OK
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',       // 404 from server confirmed session gone
  SERVER_UNREACHABLE = 'SERVER_UNREACHABLE',     // Connection refused/timeout
  DRIVER_ERROR = 'DRIVER_ERROR',                 // 500 error
  TIMEOUT = 'TIMEOUT',                           // Request timed out
}

export interface SessionHealthResult {
  isHealthy: boolean;
  state?: SessionHealthState;
  errorType: HealthErrorType;
  message?: string;
  statusCode?: number;
}

export abstract class XenonSession {
  protected sessionId: string;
  protected xenonOption: Record<string, any>;
  public isStopping: boolean = false;
  public stoppedAt?: number;
  public healthState: SessionHealthState = SessionHealthState.HEALTHY;

  constructor(private options: XenonSessionOptions) {
    this.sessionId = options.sessionId;
    this.xenonOption = options.xenonOption;
  }

  getId(): string {
    return this.sessionId;
  }

  getDevice(): IDevice {
    return this.options.device;
  }

  getDeviceFarmOptions(): Record<string, any> {
    return this.xenonOption;
  }

  getCapabilities(): Record<string, any> {
    return this.options.sessionResponse;
  }

  getXenonOption(option: XENON_CAPABILITIES, defaultValue: any = undefined): string | undefined {
    return this.xenonOption[option] ? this.xenonOption[option] : defaultValue;
  }

  abstract getScreenShot(): Promise<string>;

  abstract stopVideoRecording(driver?: any): Promise<string | null>;

  abstract startVideoRecording(
    options?: { resolution: string } | undefined,
    driver?: any,
  ): Promise<void>;

  abstract startPerformanceRecording(): Promise<void>;
  abstract stopPerformanceRecording(): Promise<string | null>;

  abstract isVideoRecordingInProgress(): boolean;

  abstract getType(): SessionType;

  abstract getLiveVideoUrl(): string | null;

  /**
   * Proactively checks if the session is still responsive.
   */
  abstract checkHealth(): Promise<SessionHealthResult>;
}
