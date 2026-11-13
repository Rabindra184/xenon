import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  clearAllScreenshotStores,
  memoryStore,
  openScreenshotStore,
  sharedScreenshotStore,
  type ScreenshotStore,
  type StoredCapture,
} from './screenshotStore';

const H1 = 'http://10.0.0.1:4723';
const H2 = 'http://10.0.0.2:4724';
const p1 = { udid: 'p1', host: H1 };
const p2 = { udid: 'p2', host: H1 };

function capture(
  id: string,
  udid: string,
  n: number,
  takenAt: number,
  // null: kept before captures named their server.
  host: string | null = H1,
): StoredCapture {
  return {
    id,
    udid,
    ...(host === null ? {} : { host }),
    n,
    takenAt,
    width: 10,
    height: 20,
    bytes: 3,
    png: new Blob(['png']),
    thumb: new Blob(['t']),
  };
}

async function exercise(store: ScreenshotStore) {
  await store.put(capture('a', 'p1', 1, 100));
  await store.put(capture('b', 'p1', 2, 200));
  await store.put(capture('c', 'p2', 1, 150));
  expect((await store.list(p1)).map((c) => c.id)).toEqual(['b', 'a']);
  expect((await store.list(p2)).map((c) => c.id)).toEqual(['c']);

  await store.delete(['b']);
  expect((await store.list(p1)).map((c) => c.id)).toEqual(['a']);

  await store.clear(p1);
  expect(await store.list(p1)).toEqual([]);
  expect((await store.list(p2)).map((c) => c.id)).toEqual(['c']);
}

// Two servers' emulator-5554: each phone's captures, plus those kept before
// captures named their server, which could be either's.
async function exerciseTwins(store: ScreenshotStore) {
  const e1 = { udid: 'emulator-5554', host: H1 };
  const e2 = { udid: 'emulator-5554', host: H2 };
  await store.put(capture('old', 'emulator-5554', 1, 50, null));
  await store.put(capture('one', 'emulator-5554', 2, 100, H1));
  await store.put(capture('two', 'emulator-5554', 3, 200, H2));
  expect((await store.list(e1)).map((c) => c.id)).toEqual(['one', 'old']);
  expect((await store.list(e2)).map((c) => c.id)).toEqual(['two', 'old']);

  // Clearing a phone clears what it lists, and leaves the other's.
  await store.clear(e1);
  expect(await store.list(e1)).toEqual([]);
  expect((await store.list(e2)).map((c) => c.id)).toEqual(['two']);
}

describe('screenshotStore', () => {
  it('keeps captures per phone in memory', async () => {
    const store = memoryStore();
    expect(store.persistent).toBe(false);
    await exercise(store);
    await exerciseTwins(store);
  });

  it('keeps captures per phone in IndexedDB, across openings', async () => {
    const idb = new IDBFactory();
    const store = await openScreenshotStore(idb);
    expect(store.persistent).toBe(true);
    await exercise(store);
    await exerciseTwins(store);

    const again = await openScreenshotStore(idb);
    const [kept] = await again.list(p2);
    expect(kept.id).toBe('c');
    expect(kept.n).toBe(1);
    expect(kept.png).toBeTruthy();
  });

  it('falls back to memory when there is no IndexedDB', async () => {
    const store = await openScreenshotStore(undefined);
    expect(store.persistent).toBe(false);
    await exercise(store);
  });

  it('falls back to memory when IndexedDB refuses to open', async () => {
    const refusing = {
      open() {
        throw new Error('SecurityError');
      },
    } as unknown as IDBFactory;
    const store = await openScreenshotStore(refusing);
    expect(store.persistent).toBe(false);
  });

  it('clearAllScreenshotStores removes every phone', async () => {
    const idb = new IDBFactory();
    const store = await openScreenshotStore(idb);
    await store.put(capture('a', 'p1', 1, 100));
    await store.put(capture('c', 'p2', 1, 150));
    await clearAllScreenshotStores(idb);
    const reopened = await openScreenshotStore(idb);
    expect(await reopened.list(p1)).toEqual([]);
    expect(await reopened.list(p2)).toEqual([]);
  });

  it('clearAllScreenshotStores never throws without IndexedDB', async () => {
    await expect(clearAllScreenshotStores(undefined)).resolves.toBeUndefined();
  });

  it('shares one store across openings until sign-out clears it', async () => {
    const first = await sharedScreenshotStore();
    expect(await sharedScreenshotStore()).toBe(first);
    await clearAllScreenshotStores(undefined);
    expect(await sharedScreenshotStore()).not.toBe(first);
  });
});
