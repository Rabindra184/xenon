import { XENON_CAPABILITIES } from '../../XenonCapabilityManager';
import type { InterceptorConfig } from '../../interfaces/IPluginArgs';
import type { InterceptorOptions } from './types';

/**
 * The network capture a session gets: its own capability (any of the shapes
 * getXenonCapabilities reads) wins field by field, and the server's
 * `interceptor` option fills in what the session leaves unset.
 *
 * - `enabled`: the session's, when it says true or false; else the server's;
 *   else off.
 * - `bufferSize`, `captureBodies`: the session's, else the server's, else the
 *   service's defaults (1000, true).
 * - `mocks`, `includeHosts`, `excludeHosts`: the session's only.
 *
 * `sessionCaps` is getXenonCapabilities' output, where a field the session
 * didn't set is `undefined`.
 */
export function resolveInterceptorOptions(
  sessionCaps: Record<string, any>,
  server: InterceptorConfig | undefined,
): InterceptorOptions {
  const own = (key: XENON_CAPABILITIES) => sessionCaps[key];
  const enabled = own(XENON_CAPABILITIES.INTERCEPTOR_ENABLED);
  const bufferSize = own(XENON_CAPABILITIES.INTERCEPTOR_BUFFER_SIZE);
  const captureBodies = own(XENON_CAPABILITIES.INTERCEPTOR_CAPTURE_BODIES);
  return {
    enabled: typeof enabled === 'boolean' ? enabled : server?.enabled === true,
    bufferSize: positive(bufferSize) ?? positive(server?.bufferSize),
    captureBodies:
      typeof captureBodies === 'boolean'
        ? captureBodies
        : typeof server?.captureBodies === 'boolean'
          ? server.captureBodies
          : true,
    mocks: listOr(own(XENON_CAPABILITIES.INTERCEPTOR_MOCKS)),
    includeHosts: listOr(own(XENON_CAPABILITIES.INTERCEPTOR_INCLUDE_HOSTS)),
    excludeHosts: listOr(own(XENON_CAPABILITIES.INTERCEPTOR_EXCLUDE_HOSTS)),
  };
}

function positive(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

function listOr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
