import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  clearAllScreenshotStores,
  memoryStore,
  openScreenshotStore,
  type ScreenshotStore,
  type StoredCapture,
} from './screenshotStore';

function capture(id: string, udid: string, n: number, takenAt: number): StoredCapture {
  return {
    id,
    udid,
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
  expect((await store.list('p1')).map((c) => c.id)).toEqual(['b', 'a']);
  expect((await store.list('p2')).map((c) => c.id)).toEqual(['c']);

  await store.delete(['b']);
  expect((await store.list('p1')).map((c) => c.id)).toEqual(['a']);

  await store.clear('p1');
  expect(await store.list('p1')).toEqual([]);
  expect((await store.list('p2')).map((c) => c.id)).toEqual(['c']);
}

describe('screenshotStore', () => {
  it('keeps captures per phone in memory', async () => {
    const store = memoryStore();
    expect(store.persistent).toBe(false);
    await exercise(store);
  });

  it('keeps captures per phone in IndexedDB, across openings', async () => {
    const idb = new IDBFactory();
    const store = await openScreenshotStore(idb);
    expect(store.persistent).toBe(true);
    await exercise(store);

    const again = await openScreenshotStore(idb);
    const [kept] = await again.list('p2');
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
    expect(await reopened.list('p1')).toEqual([]);
    expect(await reopened.list('p2')).toEqual([]);
  });

  it('clearAllScreenshotStores never throws without IndexedDB', async () => {
    await expect(clearAllScreenshotStores(undefined)).resolves.toBeUndefined();
  });
});
