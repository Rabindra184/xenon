import { AsyncLocalStorage } from 'async_hooks';

// Per-async-scope metadata that logs, traces and outbound HTTP calls can tag
// themselves with automatically. Anything populated here flows through
// awaits/timers/promise chains without having to be threaded as a parameter.
export interface SessionLogContext {
  sessionId?: string;
  udid?: string;
  requestId?: string;
  commandName?: string;
  traceId?: string;
  spanId?: string;
}

class SessionContextHolder {
  private readonly als = new AsyncLocalStorage<SessionLogContext>();

  // Open a new context frame. Inherits the parent frame's fields so child
  // run() calls can add detail (e.g. command name) without losing session ids.
  public run<T>(ctx: SessionLogContext, fn: () => T): T {
    const parent = this.als.getStore();
    const merged: SessionLogContext = { ...(parent ?? {}), ...ctx };
    return this.als.run(merged, fn);
  }

  public get(): SessionLogContext | undefined {
    return this.als.getStore();
  }

  // Mutate the active frame. Useful when a value becomes known mid-request
  // (e.g. sessionId resolved from a route param after the frame was opened).
  public update(patch: Partial<SessionLogContext>): void {
    const store = this.als.getStore();
    if (!store) return;
    Object.assign(store, patch);
  }
}

export const sessionContext = new SessionContextHolder();
