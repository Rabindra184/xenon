import { XenonSession } from './XenonSession';

export class SessionManager {
  private sessionMap: Map<string, XenonSession> = new Map();

  addSession(sessionId: string, session: XenonSession) {
    this.sessionMap.set(sessionId, session);
  }

  isValidSession(sessionId: string) {
    return this.sessionMap.has(sessionId);
  }

  getSession(sessionId: string) {
    return this.sessionMap.get(sessionId);
  }
}

export const SESSION_MANAGER = new SessionManager();
