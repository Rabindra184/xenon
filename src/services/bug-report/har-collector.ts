import { Container } from 'typedi';
import { InterceptorService } from '../InterceptorService';
import { loadArchivedHar } from '../interceptor/SessionArchive';
import { redactSecrets } from '../../logger';

export function collectHar(sessionId: string, assetsBase: string): string | null {
  try {
    const svc = Container.get(InterceptorService);
    if (svc.isActive(sessionId)) {
      const har = svc.exportHar(sessionId);
      const redacted = redactSecrets(har);
      return JSON.stringify(redacted, null, 2);
    }
  } catch {
    // fall through to archive
  }
  const archived = loadArchivedHar(assetsBase, sessionId);
  if (archived) {
    try {
      const parsed = JSON.parse(archived);
      return JSON.stringify(redactSecrets(parsed), null, 2);
    } catch {
      return archived;
    }
  }
  return null;
}
