import { XENON_CAPABILITIES } from '../XenonCapabilityManager';
import SessionType from '../enums/SessionType';
import { IDevice } from '../interfaces/IDevice';

export type XenonSessionOptions = {
  sessionId: string;
  xenonOption: Record<string, any>;
  device: IDevice;
  sessionResponse: Record<string, any>;
};

export abstract class XenonSession {
  protected sessionId: string;
  protected xenonOption: Record<string, any>;
  public isStopping: boolean = false;

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

  getDeviefarmOptions(): Record<string, any> {
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
  abstract checkHealth(): Promise<boolean>;
}
