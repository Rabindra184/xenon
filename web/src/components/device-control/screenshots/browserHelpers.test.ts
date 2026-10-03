import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyImage } from './copyImage';
import { capturesZip, uniqueNames } from './downloadAll';
import { base64ToBlob, blobBytes, makeThumbnail, pictureSize } from './imageTools';

describe('copyImage', () => {
  const original = {
    clipboard: navigator.clipboard,
    item: (globalThis as { ClipboardItem?: unknown }).ClipboardItem,
  };
  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: original.clipboard,
      configurable: true,
    });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = original.item;
  });

  it('is false where the browser has no image clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    expect(await copyImage(new Blob(['x'], { type: 'image/png' }))).toBe(false);
  });

  it('writes the picture as image/png', async () => {
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {
      constructor(public items: Record<string, Blob>) {}
    };
    const png = new Blob(['x'], { type: 'image/png' });
    expect(await copyImage(png)).toBe(true);
    const [[items]] = write.mock.calls as unknown as [[Array<{ items: Record<string, Blob> }>]];
    expect(items[0].items['image/png']).toBe(png);
  });

  it('is false when the browser refuses', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: vi.fn(async () => Promise.reject(new Error('NotAllowed'))) },
      configurable: true,
    });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = class {};
    expect(await copyImage(new Blob(['x']))).toBe(false);
  });
});

describe('downloadAll', () => {
  it('keeps every name, suffixing repeats', () => {
    expect(uniqueNames(['a.png', 'b.png', 'a.png', 'a.png'])).toEqual([
      'a.png',
      'b.png',
      'a-2.png',
      'a-3.png',
    ]);
  });

  it('zips every capture under its download name', async () => {
    const taken = new Date(2026, 9, 3, 14, 32, 5).getTime();
    const zip = await capturesZip('Galaxy S9+', [
      { n: 2, takenAt: taken, png: new Blob(['two']) },
      { n: 1, takenAt: taken, png: new Blob(['one']), markedFrom: undefined },
      { n: 3, takenAt: taken, png: new Blob(['three']), markedFrom: 2 },
    ]);
    const files = unzipSync(await blobBytes(zip));
    expect(Object.keys(files).sort()).toEqual([
      'galaxy-s9-screenshot-1-2026-10-03-14-32-05.png',
      'galaxy-s9-screenshot-2-2026-10-03-14-32-05.png',
      'galaxy-s9-screenshot-3-marked-2026-10-03-14-32-05.png',
    ]);
    expect(strFromU8(files['galaxy-s9-screenshot-2-2026-10-03-14-32-05.png'])).toBe('two');
  });
});

describe('imageTools', () => {
  it('turns the server base64 into a PNG blob', async () => {
    const blob = base64ToBlob(btoa('hello'));
    expect(blob.type).toBe('image/png');
    expect(strFromU8(await blobBytes(blob))).toBe('hello');
  });

  it('falls back where the browser cannot read or draw the picture', async () => {
    const png = new Blob(['not a picture'], { type: 'image/png' });
    expect(await pictureSize(png)).toEqual({ width: 0, height: 0 });
    expect(await makeThumbnail(png)).toBe(png);
  });
});
