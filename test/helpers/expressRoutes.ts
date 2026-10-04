/**
 * Every route an Express 4 router serves, as "METHOD /full/path" with
 * `:param` names, read from the router's own stacks. Tests only.
 *
 * It reads what is registered, so it can't miss a route a handler file
 * forgets to list. Mount paths are recovered from each layer's compiled
 * regexp, the only place Express 4 keeps them.
 */
import type { Router } from 'express';

interface Layer {
  route?: { path: string | RegExp; methods: Record<string, boolean> };
  handle: { stack?: Layer[] };
  regexp: RegExp & { fast_slash?: boolean; fast_star?: boolean };
  keys: Array<{ name: string | number }>;
}

/** '/api', '/control/:udid' or '' from a `use()` layer's regexp. */
export function mountPath(layer: Layer): string {
  if (layer.regexp.fast_slash) return '';
  let n = 0;
  return layer.regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/i, '')
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => `:${layer.keys[n++]?.name ?? 'param'}`)
    .replace(/\\\//g, '/')
    .replace(/\\\./g, '.')
    .replace(/\\-/g, '-');
}

function join(a: string, b: string): string {
  const joined = `${a}/${b}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

export function routesOf(router: Router | { stack: Layer[] }, prefix = ''): Set<string> {
  const out = new Set<string>();
  const walk = (stack: Layer[], at: string) => {
    for (const layer of stack) {
      if (layer.route) {
        const path = join(at, String(layer.route.path));
        for (const [method, on] of Object.entries(layer.route.methods)) {
          if (on && method !== '_all') out.add(`${method.toUpperCase()} ${path}`);
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, join(at, mountPath(layer)));
      }
    }
  };
  walk((router as { stack: Layer[] }).stack, prefix);
  return out;
}
