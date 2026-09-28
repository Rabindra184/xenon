import type { RequestHandler } from 'express';

/**
 * Put a middleware in front of every route an Express app already has.
 *
 * Appium adds its WebDriver routes (`configureServer` → `addRoutes`) before it
 * runs any plugin's `updateServer`. A plain `app.use()` from a plugin is
 * therefore appended after those routes, and a route that answers a request
 * never calls `next()`, so the middleware would never see a WebDriver command.
 * The only way in front of them is to splice the new layer into the router's
 * stack ahead of the first route layer.
 *
 * Where the router lives depends on the Express major:
 * - Express 4: `app._router`, created lazily; reading `app.router` throws.
 * - Express 5 (what Appium 3 runs): `app.router`; `app._router` is gone.
 *
 * The layer itself is built by `app.use()`, so its path matching (including
 * case sensitivity) follows the same router settings as the routes it guards.
 * The helper only moves it.
 *
 * When no router can be found it adds nothing and returns `placed: false`, so
 * the caller decides how loudly to fail. Appending instead would put the
 * middleware behind the routes: present, and bypassed by every command.
 */
export interface InsertResult {
  placed: boolean;
  /** Which Express shape the router was found on. */
  shape?: 'express4' | 'express5';
  /** Index the layer now occupies in the router stack. */
  index?: number;
  /** Why it was not placed. */
  reason?: string;
}

interface RouterLike {
  stack: any[];
}

function isRouter(candidate: unknown): candidate is RouterLike {
  return !!candidate && Array.isArray((candidate as RouterLike).stack);
}

function findRouter(app: any): { router: RouterLike; shape: 'express4' | 'express5' } | undefined {
  if (!app) return undefined;
  if (isRouter(app._router)) return { router: app._router, shape: 'express4' };
  let router: unknown;
  try {
    // Express 4 defines `app.router` as a getter that throws a deprecation
    // error. Express 5 defines it as the router itself.
    router = app.router;
  } catch {
    router = undefined;
  }
  if (isRouter(router)) return { router, shape: 'express5' };
  return undefined;
}

/** The app's router stack, or undefined when neither Express shape has one. */
export function routerStackOf(app: any): any[] | undefined {
  return findRouter(app)?.router.stack;
}

export function insertBeforeRoutes(app: any, path: string, handler: RequestHandler): InsertResult {
  const found = findRouter(app);
  if (!found) {
    return {
      placed: false,
      reason: 'no Express router found (neither app._router nor app.router has a stack)',
    };
  }

  const { stack } = found.router;
  const lengthBefore = stack.length;
  app.use(path, handler);
  const added = stack.splice(lengthBefore);
  if (added.length !== 1) {
    // app.use() added its layer somewhere other than the stack we found, or
    // added more than one. Put back whatever it added and refuse to guess.
    stack.push(...added);
    return {
      placed: false,
      shape: found.shape,
      reason: `app.use() added ${added.length} layers to the router stack, expected 1`,
    };
  }

  const firstRoute = stack.findIndex((layer: any) => !!layer.route);
  const index = firstRoute === -1 ? stack.length : firstRoute;
  stack.splice(index, 0, added[0]);
  return { placed: true, shape: found.shape, index };
}
