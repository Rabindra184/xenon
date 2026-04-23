import { Service, Container } from 'typedi';
import log from '../logger';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { SessionLifecycleService } from './SessionLifecycleService';

// Graceful shutdown phase that runs BEFORE the existing infrastructure
// teardown in index.ts:cleanup(). Active sessions get a bounded chance to
// archive their video + release ports + mark themselves failed, so we don't
// leak a half-recorded session and a permanently-busy device every time the
// hub is redeployed.
//
// Bounded by two timeouts:
//   - per-session: a single hung driver can't block the rest from finishing
//   - overall: if the fleet is very large, the shutdown still exits in time
//     for init systems (systemd defaults to 90s before SIGKILL)
@Service()
export class ShutdownCoordinator {
  private draining = false;
  private readonly logger = log.scope('Shutdown');

  public get isDraining(): boolean {
    return this.draining;
  }

  public async drain(
    timeoutMs: number,
    perSessionTimeoutMs = 10_000,
  ): Promise<{ attempted: number; completed: number }> {
    if (this.draining) {
      this.logger.warn('drain() called while already draining; ignoring');
      return { attempted: 0, completed: 0 };
    }
    this.draining = true;

    const sessions = SESSION_MANAGER.getAllSessions();
    if (sessions.length === 0) {
      this.logger.info('No active sessions to drain');
      return { attempted: 0, completed: 0 };
    }

    this.logger.info(
      `Draining ${sessions.length} active session(s) (overall=${timeoutMs}ms, per-session=${perSessionTimeoutMs}ms)`,
    );
    const lifecycle = Container.get(SessionLifecycleService);
    const deadline = Date.now() + timeoutMs;

    const tasks = sessions.map(async (session) => {
      const id = session.getId();
      const remaining = Math.max(0, deadline - Date.now());
      const budget = Math.min(perSessionTimeoutMs, remaining);
      if (budget <= 0) {
        this.logger.warn(`[shutdown] No budget left for session ${id}; skipping`);
        return false;
      }
      try {
        await Promise.race([
          lifecycle.stopSessionForShutdown(id, 'Hub shutdown'),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('per-session drain timeout')), budget),
          ),
        ]);
        return true;
      } catch (err: any) {
        this.logger.warn(`[shutdown] Failed to drain session ${id}: ${err.message}`);
        return false;
      }
    });

    const results = await Promise.allSettled(tasks);
    const completed = results.filter(
      (r) => r.status === 'fulfilled' && (r as PromiseFulfilledResult<boolean>).value,
    ).length;

    this.logger.info(`Drain complete: ${completed}/${sessions.length} session(s) finalized`);
    return { attempted: sessions.length, completed };
  }
}
