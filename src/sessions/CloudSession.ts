import type { AxiosRequestConfig } from 'axios';
import SessionType from '../enums/SessionType';
import { RemoteSession } from './RemoteSession';
import type { SessionHealthResult } from './XenonSession';

export class CloudSession extends RemoteSession {
  getType(): SessionType {
    return SessionType.CLOUD;
  }

  /** A cloud provider is not a Xenon node: it never gets the hub's session token. */
  protected async callOptions(): Promise<AxiosRequestConfig> {
    return {};
  }

  /** A cloud provider has no Xenon session-status route: the WebDriver probe it is. */
  protected async askNodeForSession(): Promise<SessionHealthResult | null> {
    return null;
  }

  async getScreenShot(): Promise<string> {
    return '';
  }

  getVideo(): string {
    return '';
  }

  async startVideoRecording(_options?: any, _driver?: any) {
    // no action
  }

  isVideoRecordingInProgress(): boolean {
    return false;
  }

  getLiveVideoUrl() {
    return null;
  }
}
