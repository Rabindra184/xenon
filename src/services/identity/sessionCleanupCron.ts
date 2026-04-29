import { Container } from 'typedi';
import { UserSessionService } from '../UserSessionService';
import log from '../../logger';

const HOUR_MS = 60 * 60 * 1000;

export function startUserSessionCleanupCron() {
  const svc = Container.get(UserSessionService);
  const l = log.scope('UserSession-Cron');
  // Run once shortly after boot, then every hour.
  setTimeout(() => {
    svc.cleanupExpired().catch((e) => l.error('cleanup failed', e));
  }, 30_000);
  setInterval(() => {
    svc.cleanupExpired().catch((e) => l.error('cleanup failed', e));
  }, HOUR_MS).unref();
}
