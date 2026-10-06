// Display helpers for filesystem paths. Pure on purpose: the renderer bundles
// src/shared, so the home directory is passed in rather than read from `os`.

/** Show `p` with a leading `home` replaced by `~`; anything outside home is unchanged. */
export function tildify(p: string, home: string): string {
  if (!home) return p;
  if (p === home) return '~';
  const prefix = home.endsWith('/') ? home : `${home}/`;
  return p.startsWith(prefix) ? `~/${p.slice(prefix.length)}` : p;
}

/** The reverse of `tildify`: a leading `~/` (or a bare `~`) becomes `home`; anything else is unchanged. */
export function expandHome(p: string, home: string): string {
  if (!home) return p;
  const base = home.endsWith('/') ? home.slice(0, -1) : home;
  if (p === '~') return base;
  return p.startsWith('~/') ? `${base}/${p.slice(2)}` : p;
}
