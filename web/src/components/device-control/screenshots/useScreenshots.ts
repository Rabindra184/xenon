import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import XenonApiService from '../../../api-service';
import { useToast } from '../../ui/toast';
import { failed } from '../actionMessages';
import { captureLabel } from './captureMeta';
import { base64ToBlob, makeThumbnail, pictureSize } from './imageTools';
import { openScreenshotStore, type ScreenshotStore, type StoredCapture } from './screenshotStore';

/** Kept per phone in this browser; the oldest goes when another is taken. */
export const MAX_KEPT = 50;
export const UNDO_MS = 6000;

/** A kept capture with URLs for its picture and thumbnail, valid while it is listed. */
export interface Capture extends StoredCapture {
  url: string;
  thumbUrl: string;
}

function withUrls(rec: StoredCapture): Capture {
  const url = URL.createObjectURL(rec.png);
  // The thumbnail is the picture itself when the browser couldn't make one.
  const thumbUrl = rec.thumb === rec.png ? url : URL.createObjectURL(rec.thumb);
  return { ...rec, url, thumbUrl };
}

function revoke(c: Capture): void {
  URL.revokeObjectURL(c.url);
  if (c.thumbUrl !== c.url) URL.revokeObjectURL(c.thumbUrl);
}

function bare({ url: _url, thumbUrl: _thumb, ...rec }: Capture): StoredCapture {
  return rec;
}

function newestFirst(a: StoredCapture, b: StoredCapture): number {
  return b.takenAt - a.takenAt || b.n - a.n;
}

/**
 * Device control's screenshots of one phone: loaded from this browser, taken,
 * deleted and cleared with Undo, capped at the newest 50.
 */
export function useScreenshots(
  udid: string,
  openStore: () => Promise<ScreenshotStore> = openScreenshotStore,
) {
  const { toast } = useToast();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [taking, setTaking] = useState(false);

  const storeRef = useRef<ScreenshotStore | null>(null);
  const capturesRef = useRef<Capture[]>([]);
  capturesRef.current = captures;
  // The highest number given out on this page, deleted ones held for Undo
  // included, so a restored capture never shares its number with a new one.
  const highestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    setReady(false);
    setCaptures([]);
    setSelectedId(null);
    highestRef.current = 0;
    (async () => {
      const store = await openStore();
      let rows: StoredCapture[] = [];
      try {
        rows = await store.list(udid);
      } catch {
        rows = [];
      }
      if (cancelled) return;
      storeRef.current = store;
      const listed = rows.slice(0, MAX_KEPT).map(withUrls);
      highestRef.current = listed.reduce((m, c) => Math.max(m, c.n), 0);
      setPersistent(store.persistent);
      setCaptures(listed);
      setSelectedId(listed[0]?.id ?? null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // openStore is a dependency for tests only; device control passes none.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [udid]);

  // Every picture URL goes when the tab does.
  useEffect(
    () => () => {
      mountedRef.current = false;
      capturesRef.current.forEach(revoke);
    },
    [],
  );

  const keep = useCallback(
    async (rec: StoredCapture) => {
      const store = storeRef.current;
      if (!store) return;
      try {
        await store.put(rec);
      } catch {
        toast(
          `Couldn’t keep ${captureLabel(rec)} in this browser. It’s here until you leave the page.`,
          'error',
        );
      }
    },
    [toast],
  );

  /** Adds captures, newest first, dropping (and forgetting) any past the newest 50. */
  const insert = useCallback((added: Capture[], select: string) => {
    const next = [...added, ...capturesRef.current].sort(newestFirst);
    const dropped = next.slice(MAX_KEPT);
    const kept = next.slice(0, MAX_KEPT);
    dropped.forEach(revoke);
    if (dropped.length) storeRef.current?.delete(dropped.map((c) => c.id)).catch(() => undefined);
    capturesRef.current = kept;
    setCaptures(kept);
    setSelectedId(kept.some((c) => c.id === select) ? select : (kept[0]?.id ?? null));
  }, []);

  const addPicture = useCallback(
    async (png: Blob, extra: Partial<StoredCapture> = {}) => {
      const [size, thumb] = await Promise.all([pictureSize(png), makeThumbnail(png)]);
      if (!mountedRef.current) return;
      highestRef.current += 1;
      const rec: StoredCapture = {
        id: uuidv4(),
        udid,
        n: highestRef.current,
        takenAt: Date.now(),
        width: size.width,
        height: size.height,
        bytes: png.size,
        png,
        thumb,
        ...extra,
      };
      insert([withUrls(rec)], rec.id);
      await keep(rec);
    },
    [udid, insert, keep],
  );

  const take = useCallback(async () => {
    setTaking(true);
    try {
      let result: { screenshot?: string; error?: string; message?: string } | null;
      try {
        result = await XenonApiService.getScreenshot(udid);
      } catch (err) {
        toast(failed('take a screenshot', err), 'error');
        return;
      }
      if (!result?.screenshot) {
        const reason = result?.error || result?.message;
        toast(
          reason
            ? failed('take a screenshot', { message: reason })
            : 'Couldn’t take a screenshot. The phone sent no picture.',
          'error',
        );
        return;
      }
      await addPicture(base64ToBlob(result.screenshot));
    } finally {
      if (mountedRef.current) setTaking(false);
    }
  }, [udid, toast, addPicture]);

  const addMarkedCopy = useCallback(
    (original: Capture, png: Blob) => addPicture(png, { markedFrom: original.n }),
    [addPicture],
  );

  const restore = useCallback(
    async (recs: StoredCapture[]) => {
      if (!mountedRef.current || !recs.length) return;
      const back = recs.filter((r) => !capturesRef.current.some((c) => c.id === r.id));
      insert(back.map(withUrls), recs[0].id);
      const store = storeRef.current;
      await Promise.all(back.map((r) => store?.put(r).catch(() => undefined)));
    },
    [insert],
  );

  const remove = useCallback(
    async (id: string) => {
      const list = capturesRef.current;
      const i = list.findIndex((c) => c.id === id);
      if (i < 0) return;
      const gone = list[i];
      const kept = list.filter((c) => c.id !== id);
      capturesRef.current = kept;
      setCaptures(kept);
      setSelectedId((sel) => (sel === id ? ((kept[i] ?? kept[i - 1])?.id ?? null) : sel));
      revoke(gone);
      const rec = bare(gone);
      toast(`Deleted ${captureLabel(gone)}`, 'info', UNDO_MS, {
        label: 'Undo',
        onClick: () => void restore([rec]),
      });
      await storeRef.current?.delete([id]).catch(() => undefined);
    },
    [toast, restore],
  );

  const clearAll = useCallback(async () => {
    const all = capturesRef.current;
    if (!all.length) return;
    capturesRef.current = [];
    setCaptures([]);
    setSelectedId(null);
    all.forEach(revoke);
    const recs = all.map(bare);
    toast(`Cleared ${all.length} screenshot${all.length === 1 ? '' : 's'}`, 'info', UNDO_MS, {
      label: 'Undo',
      onClick: () => void restore(recs),
    });
    await storeRef.current?.clear(udid).catch(() => undefined);
  }, [udid, toast, restore]);

  return {
    captures,
    selectedId,
    select: setSelectedId,
    ready,
    persistent,
    taking,
    take,
    addMarkedCopy,
    remove,
    clearAll,
  };
}
