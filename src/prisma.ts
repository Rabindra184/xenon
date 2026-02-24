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

export const prisma = new Proxy({} as PrismaClient, {
  get: (target, prop) => {
    return (getPrismaClient() as any)[prop];
  },
});
