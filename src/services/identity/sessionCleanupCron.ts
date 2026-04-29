import { Container } from 'typedi';
import { UserSessionService } from '../UserSessionService';
import { PasswordResetService } from '../PasswordResetService';
import log from '../../logger';

const HOUR_MS = 60 * 60 * 1000;

export function startUserSessionCleanupCron() {
  const sessionSvc = Container.get(UserSessionService);
  const resetSvc = Container.get(PasswordResetService);
  const l = log.scope('Cleanup-Cron');
  const tick = async () => {
    await sessionSvc.cleanupExpired().catch((e) => l.error('session cleanup failed', e));
    await resetSvc.cleanupExpired().catch((e) => l.error('reset-token cleanup failed', e));
  };
  // Run once shortly after boot, then every hour.
  setTimeout(tick, 30_000);
  setInterval(tick, HOUR_MS).unref();
}
