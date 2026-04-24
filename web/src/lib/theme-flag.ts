const KEY = 'xenon.themeV2';

export function isThemeV2(): boolean {
  try {
    const url = new URLSearchParams(window.location.search);
    const override = url.get('themeV2');
    if (override === '0' || override === 'off') return false;
    if (override === '1' || override === 'on') return true;

    const stored = window.localStorage.getItem(KEY);
    if (stored === 'off') return false;
    // Default ON during and after phase 2.
    return true;
  } catch {
    return true;
  }
}

export function applyThemeFlag(): void {
  const on = isThemeV2();
  document.documentElement.setAttribute('data-theme', on ? 'v2' : 'v1');
}

export function setThemeV2(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // ignore quota errors
  }
  applyThemeFlag();
}
