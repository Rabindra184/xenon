/**
 * Puts a picture on the user's clipboard. The image clipboard exists only on
 * secure origins (https, localhost): a lab dashboard on http://<lan-ip> has
 * none, so this answers false there and the caller suggests Download.
 */
export async function copyImage(png: Blob): Promise<boolean> {
  const Item = (globalThis as { ClipboardItem?: new (items: Record<string, Blob>) => unknown })
    .ClipboardItem;
  const clipboard = navigator.clipboard as (Clipboard & { write?: unknown }) | undefined;
  if (!Item || typeof clipboard?.write !== 'function') return false;
  try {
    const typed = png.type === 'image/png' ? png : new Blob([png], { type: 'image/png' });
    await clipboard.write([new Item({ 'image/png': typed }) as ClipboardItem]);
    return true;
  } catch {
    return false;
  }
}
