/**
 * Where device control's screenshots are kept: this browser's IndexedDB, per
 * phone, so they survive a reload and leaving the phone. When IndexedDB is
 * missing or refuses to open (a private window, storage blocked) the same
 * interface keeps them in memory, for as long as the page is open.
 */

export interface StoredCapture {
  id: string;
  udid: string;
  /** The phone's own number for it, "Screenshot 12". */
  n: number;
  takenAt: number;
  width: number;
  height: number;
  bytes: number;
  png: Blob;
  /** A small copy for the rail: 50 full PNGs would decode to most of a gigabyte. */
  thumb: Blob;
  /** On a marked copy, the number of the capture it was drawn on. */
  markedFrom?: number;
}

export interface ScreenshotStore {
  /** False when captures last only as long as the page. */
  readonly persistent: boolean;
  /** A phone's captures, newest first. */
  list(udid: string): Promise<StoredCapture[]>;
  put(capture: StoredCapture): Promise<void>;
  delete(ids: string[]): Promise<void>;
  clear(udid: string): Promise<void>;
}

export const DB_NAME = 'xenon-screenshots';
const STORE = 'captures';
const BY_UDID = 'udid';

function newestFirst(a: StoredCapture, b: StoredCapture): number {
  return b.takenAt - a.takenAt || b.n - a.n;
}

export function memoryStore(): ScreenshotStore {
  const rows = new Map<string, StoredCapture>();
  return {
    persistent: false,
    async list(udid) {
      return Array.from(rows.values())
        .filter((r) => r.udid === udid)
        .sort(newestFirst);
    },
    async put(capture) {
      rows.set(capture.id, capture);
    },
    async delete(ids) {
      ids.forEach((id) => rows.delete(id));
    },
    async clear(udid) {
      Array.from(rows.values())
        .filter((r) => r.udid === udid)
        .forEach((r) => rows.delete(r.id));
    },
  };
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex(BY_UDID, 'udid');
    };
    req.onsuccess = () => {
      const db = req.result;
      // Sign-out deletes the database; this connection must not hold that up.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

function indexedDbStore(db: IDBDatabase): ScreenshotStore {
  const write = async (fn: (store: IDBObjectStore) => void) => {
    const tx = db.transaction(STORE, 'readwrite');
    fn(tx.objectStore(STORE));
    await finished(tx);
  };
  return {
    persistent: true,
    async list(udid) {
      const tx = db.transaction(STORE, 'readonly');
      const rows = await done(
        tx.objectStore(STORE).index(BY_UDID).getAll(udid) as IDBRequest<StoredCapture[]>,
      );
      return rows.sort(newestFirst);
    },
    put: (capture) => write((s) => s.put(capture)),
    delete: (ids) => write((s) => ids.forEach((id) => s.delete(id))),
    async clear(udid) {
      const tx = db.transaction(STORE, 'readwrite');
      const index = tx.objectStore(STORE).index(BY_UDID);
      const keys = await done(index.getAllKeys(udid));
      keys.forEach((k) => tx.objectStore(STORE).delete(k));
      await finished(tx);
    },
  };
}

function browserIdb(): IDBFactory | undefined {
  try {
    return typeof indexedDB === 'undefined' ? undefined : indexedDB;
  } catch {
    return undefined;
  }
}

/** The browser's store, or a memory one where this browser keeps nothing. */
export async function openScreenshotStore(
  idb: IDBFactory | undefined = browserIdb(),
): Promise<ScreenshotStore> {
  if (!idb) return memoryStore();
  try {
    return indexedDbStore(await openDb(idb));
  } catch {
    return memoryStore();
  }
}

let shared: Promise<ScreenshotStore> | null = null;

/** One store for the page: every device control opening shares its connection. */
export function sharedScreenshotStore(): Promise<ScreenshotStore> {
  if (!shared) shared = openScreenshotStore();
  return shared;
}

/**
 * Remove every phone's captures from this browser, for sign-out. Best effort
 * and bounded: sign-out must never wait on storage.
 */
export async function clearAllScreenshotStores(
  idb: IDBFactory | undefined = browserIdb(),
  timeoutMs = 1000,
): Promise<void> {
  shared = null;
  if (!idb) return;
  const deleted = new Promise<void>((resolve) => {
    try {
      const req = idb.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
  await Promise.race([deleted, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}
