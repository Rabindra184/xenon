import { PrismaClient } from './generated/client';
import { config } from './config';
import log from './logger';

let _prisma: PrismaClient | undefined;

export const getPrismaClient = (): PrismaClient => {
  if (!_prisma) {
    try {
      _prisma = new PrismaClient({
        datasources: {
          db: {
            url: config.databaseUrl,
          },
        },
      });
    } catch (error: any) {
      log.error(
        '❌ [Prisma] Failed to initialize PrismaClient. Ensure "npx prisma generate" has been run.',
        error,
      );
      throw error;
    }
  }
  return _prisma;
};

/**
 * Model delegate names in Prisma — lowercase camelCase names of every model.
 * These are wrapped in plain objects so that sinon (and other test frameworks)
 * can stub individual methods (Prisma's internal Proxy blocks property assignment).
 */
const MODEL_DELEGATES = new Set([
  'build', 'session', 'sessionLog', 'log', 'profiling', 'app', 'device',
  'pendingSession', 'cLIArgs', 'webhookConfig', 'webConfig', 'locatorEtalon',
  'portLease', 'apiKey', 'selectorState', 'user', 'userSession',
]);

/** Cache of plain-object wrappers, keyed by model name. */
const _modelWrappers = new Map<string, Record<string, unknown>>();

/**
 * Build a plain-object wrapper around a Prisma model delegate.
 * The wrapper forwards every method call to the real delegate, but because
 * it is a regular object (not a Proxy), sinon can replace individual methods.
 */
function wrapModelDelegate(delegate: any): Record<string, unknown> {
  const wrapper: Record<string, unknown> = {};
  const methods = [
    'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow',
    'findMany', 'create', 'createMany', 'createManyAndReturn',
    'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
    'groupBy', 'count', 'aggregate',
  ];
  for (const m of methods) {
    if (typeof delegate[m] === 'function') {
      wrapper[m] = function (...args: unknown[]) {
        return (delegate[m] as Function).apply(delegate, args);
      };
    }
  }
  return wrapper;
}

export const prisma = new Proxy({} as PrismaClient, {
  get: (_target, prop: string) => {
    const client = getPrismaClient();
    const value = (client as any)[prop];
    // Wrap model delegates in plain objects so test frameworks can stub them.
    if (MODEL_DELEGATES.has(prop)) {
      if (!_modelWrappers.has(prop)) {
        _modelWrappers.set(prop, wrapModelDelegate(value));
      }
      return _modelWrappers.get(prop);
    }
    return value;
  },
});
