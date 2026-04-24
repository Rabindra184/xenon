/**
 * Theme flag — v1.5.0 onwards the v2 theme is the only theme.
 * These helpers are retained as permanent no-ops so any remaining call
 * sites in third-party code or in-flight PRs keep compiling. They will
 * be deleted in a later maintenance pass once all internal callers
 * have been removed.
 */

export function isThemeV2(): boolean {
  return true;
}

export function applyThemeFlag(): void {
  // no-op — tokens are now in :root.
}

export function setThemeV2(_on: boolean): void {
  // no-op — v2 is the only theme.
}
