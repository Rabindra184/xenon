import { DeviceStoreFactory } from '../../src/data-service/device-store';
import {
  PrismaCLIArgsStore,
  PrismaDeviceStore,
  PrismaHealEtalonStore,
  PrismaPendingSessionStore,
} from '../../src/data-service/prisma-store';

// DeviceStoreFactory's cached stores, one per kind.
const CACHES = ['_deviceStore', '_pendingSessionStore', '_cliArgsStore', '_healEtalonStore'];

/**
 * The in-memory (Loki) stores for the enclosing `describe`, however the file
 * was started.
 *
 * DeviceStoreFactory picks Loki only while NODE_ENV is 'test'. `npm run
 * test:all` sets it; `npx mocha <file>` doesn't, so a spec run on its own got
 * the Prisma stores, which read and write the developer's
 * ~/.cache/xenon/xenon.db. This holds NODE_ENV at 'test' and hands the
 * factory new stores for the suite, then puts both back.
 *
 * Call it inside a `describe`, before the hooks that use a store, never at the
 * top of a file.
 */
export function useLokiStores(): void {
  const factory = DeviceStoreFactory as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  let previousEnv: string | undefined;

  before(() => {
    previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    for (const key of CACHES) {
      saved[key] = factory[key];
      factory[key] = undefined;
    }
  });

  after(() => {
    for (const key of CACHES) factory[key] = saved[key];
    // Assigning undefined would store the string 'undefined'.
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  });
}

/**
 * The Prisma stores (what a server with SQLite runs) for the enclosing
 * `describe`, however the file was started. Put the suite's database behind
 * them first: `useScratchDatabase({ wholeSuite: true })`.
 *
 * `npm run test:all` sets NODE_ENV to 'test', so DeviceStoreFactory hands it
 * Loki stores, while `npx mocha <file>` gets Prisma ones. A spec written
 * against the Prisma store's queries then tested Loki in the full run, and its
 * phones stayed in Loki's one collection for every later spec. This hands the
 * factory new Prisma stores for the suite, then puts the old ones back. A
 * module that took its store when it was imported (`grid.ts`) keeps that one.
 *
 * Call it inside a `describe`, before the hooks that use a store, never at the
 * top of a file.
 */
export function usePrismaStores(): void {
  const factory = DeviceStoreFactory as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};

  before(() => {
    for (const key of CACHES) saved[key] = factory[key];
    factory._deviceStore = new PrismaDeviceStore();
    factory._pendingSessionStore = new PrismaPendingSessionStore();
    factory._cliArgsStore = new PrismaCLIArgsStore();
    factory._healEtalonStore = new PrismaHealEtalonStore();
  });

  after(() => {
    for (const key of CACHES) factory[key] = saved[key];
  });
}
