const FOCUSABLE = 'input, textarea, select, button';

/** Selector for the element that wraps (or is) a setting's control. Quotes and backslashes in the key can't break out of it. */
export function settingSelector(path: string): string {
  return `[data-setting-key="${path.replace(/[\\"]/g, '\\$&')}"]`;
}

/**
 * Bring a setting into view and put the cursor in it. `path` is a setting key
 * or a server field like `server.port`; the wrapper is marked with
 * `data-setting-key`. Does nothing when that setting isn't on screen.
 */
export function focusSetting(path: string): void {
  const el = document.querySelector<HTMLElement>(settingSelector(path));
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  const control = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
  control?.focus();
}
