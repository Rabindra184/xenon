// The window is light or dark as the Mac is. The main process decides what
// that means (nativeTheme.themeSource: the Mac's own setting, or the person's
// Light or Dark choice) and the window's prefers-color-scheme follows it, so
// the renderer only ever has to follow that media query. tokens.css reads the
// result from <html data-theme>.

export type Theme = 'light' | 'dark';

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Apply the current theme now and again on every change. Returns a function that stops watching. */
export function watchSystemTheme(): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = (): void => applyTheme(query.matches ? 'dark' : 'light');
  apply();
  query.addEventListener('change', apply);
  return () => query.removeEventListener('change', apply);
}
