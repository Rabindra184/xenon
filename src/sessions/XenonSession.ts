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
  HEALTHY = 'HEALTHY', // 0 failures
  DEGRADED = 'DEGRADED', // 1+ failures
  SUSPECT = 'SUSPECT', // 3+ failures
  DEAD = 'DEAD', // 6 failures or session verified gone
}

export enum HealthErrorType {
  NONE = 'NONE',
  UNSUPPORTED_ENDPOINT = 'UNSUPPORTED_ENDPOINT', // 404 on orientation but server OK
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND', // 404 from server confirmed session gone
  SERVER_UNREACHABLE = 'SERVER_UNREACHABLE', // Connection refused/timeout
  DRIVER_ERROR = 'DRIVER_ERROR', // 500 error
  TIMEOUT = 'TIMEOUT', // Request timed out
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
  public isStopping = false;
  public stoppedAt?: number;
  public healthState: SessionHealthState = SessionHealthState.HEALTHY;
  // Phase 2 audit: which API key created this session (null when auth is
  // disabled or the client didn't present xenon:accessKey).
  public apiKeyId: string | null = null;
  // The human who created this session, resolved from either the API-key
  // pair or a bare xenon:options.sessionToken (see resolveSessionIdentity).
  // Null when auth is disabled or the caller couldn't be attributed.
  public userId: string | null = null;

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

  /**
   * The UI hierarchy as the *driver* sees it.
   *
   * Deliberately separate from `IDeviceManager.getPageSource`, which asks the
   * device directly. On Android that means `uiautomator dump`, and Android
   * permits only one UiAutomator instrumentation at a time — while
   * io.appium.uiautomator2.server holds it the dump is SIGKILLed, so a device
   * with a live session cannot be inspected that way at all. Asking the
   * session is also the only way to see the tree Appium will actually resolve
   * a locator against.
   */
  abstract getPageSource(): Promise<string>;

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
