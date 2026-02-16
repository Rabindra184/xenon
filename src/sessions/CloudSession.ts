import SessionType from '../enums/SessionType';
import { RemoteSession } from './RemoteSession';

export class CloudSession extends RemoteSession {
  getType(): SessionType {
    return SessionType.CLOUD;
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
