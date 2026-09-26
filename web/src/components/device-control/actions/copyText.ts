export const COPY_BLOCKED =
  'Your browser blocked copying here. The text is selected, so press ⌘C or Ctrl+C.';

/**
 * Copies to the user's own clipboard. The clipboard API exists only on secure
 * origins (https, localhost); a lab dashboard on http://<lan-ip> has none, so
 * callers fall back to selecting the text when this returns false.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
