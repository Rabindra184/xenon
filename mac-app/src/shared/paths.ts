// Display helpers for filesystem paths. Pure on purpose: the renderer bundles
// src/shared, so the home directory is passed in rather than read from `os`.

/** Show `p` with a leading `home` replaced by `~`; anything outside home is unchanged. */
export function tildify(p: string, home: string): string {
  if (!home) return p;
  if (p === home) return '~';
  const prefix = home.endsWith('/') ? home : `${home}/`;
  return p.startsWith(prefix) ? `~/${p.slice(prefix.length)}` : p;
}
