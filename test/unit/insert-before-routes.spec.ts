import { expect } from 'chai';
import path from 'path';
import express4 from 'express';
import request from 'supertest';
import { insertBeforeRoutes, routerStackOf } from '../../src/app/insertBeforeRoutes';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * Appium adds its WebDriver routes before any plugin's updateServer runs, so a
 * plugin middleware added with app.use() lands after them and never sees a
 * command a route answers. insertBeforeRoutes splices it in front of the first
 * route layer instead.
 *
 * The repo's own Express is 4 (router at app._router, and reading app.router
 * throws). Appium 3 runs Express 5 (router at app.router, no app._router). The
 * Express 5 here is the one Appium itself resolves, so these tests run against
 * the router Xenon actually meets in production.
 */
function appiumExpress(): any {
  const appiumDir = path.dirname(require.resolve('appium/package.json'));
  const resolved = require.resolve('express', { paths: [appiumDir] });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const version: string = require(path.join(path.dirname(resolved), 'package.json')).version;
  expect(version.split('.')[0], `Appium's express at ${resolved}`).to.equal('5');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(resolved);
}

const shapes: Array<[string, () => any]> = [
  ['Express 4 (app._router)', () => express4()],
  ['Express 5 (app.router), as Appium 3 runs it', () => appiumExpress()()],
];

describe('insertBeforeRoutes', () => {
  for (const [name, makeApp] of shapes) {
    describe(name, () => {
      const loopback = loopbackServers();

      afterEach(() => loopback.closeAll());

      /** An app whose routes exist before the middleware is added, as Appium's do. */
      function appWithRoutes() {
        const ran: string[] = [];
        const app = makeApp();
        // Appium's own middleware comes first, then its routes.
        app.use((_req: any, _res: any, next: any) => {
          ran.push('appium-middleware');
          next();
        });
        app.get('/wd/hub/session/:sessionId/url', (req: any, res: any) => {
          ran.push(`route:${req.params.sessionId}`);
          res.json({ value: 'about:blank' });
        });
        app.post('/wd/hub/session', (_req: any, res: any) => {
          ran.push('route:createSession');
          res.json({ value: { sessionId: 'new' } });
        });
        return { app, ran };
      }

      it('finds the router stack', () => {
        const { app } = appWithRoutes();
        const stack = routerStackOf(app) ?? [];
        expect(routerStackOf(app)).to.be.an('array');
        expect(stack.some((layer: any) => layer.route)).to.equal(true);
      });

      it('runs the middleware before a route registered earlier', async () => {
        const { app, ran } = appWithRoutes();
        const result = insertBeforeRoutes(
          app,
          '/wd/hub/session/:sessionId',
          (req: any, _res: any, next: any) => {
            ran.push(`guard:${req.params.sessionId}`);
            next();
          },
        );
        expect(result.placed).to.equal(true);

        await request(await loopback.serve(app))
          .get('/wd/hub/session/abc/url')
          .expect(200);
        expect(ran).to.deep.equal(['appium-middleware', 'guard:abc', 'route:abc']);
      });

      it('can answer the request itself, so the route never runs', async () => {
        const { app, ran } = appWithRoutes();
        insertBeforeRoutes(app, '/wd/hub/session/:sessionId', (_req: any, res: any) => {
          res.status(404).json({ refused: true });
        });

        const res = await request(await loopback.serve(app))
          .get('/wd/hub/session/abc/url')
          .expect(404);
        expect(res.body).to.deep.equal({ refused: true });
        expect(ran).to.deep.equal(['appium-middleware']);
      });

      it('leaves routes outside its path alone', async () => {
        const { app, ran } = appWithRoutes();
        insertBeforeRoutes(app, '/wd/hub/session/:sessionId', (_req: any, _res: any, next: any) => {
          ran.push('guard');
          next();
        });

        await request(await loopback.serve(app))
          .post('/wd/hub/session')
          .send({})
          .expect(200);
        expect(ran).to.deep.equal(['appium-middleware', 'route:createSession']);
      });

      it('keeps the layers that were ahead of the first route ahead of it', () => {
        const { app } = appWithRoutes();
        const before = (routerStackOf(app) ?? []).slice();
        const firstRoute = before.findIndex((layer: any) => layer.route);
        insertBeforeRoutes(app, '/x', (_req: any, _res: any, next: any) => next());
        const after = routerStackOf(app) ?? [];

        expect(after.length).to.equal(before.length + 1);
        expect(after.slice(0, firstRoute)).to.deep.equal(before.slice(0, firstRoute));
        expect(after[firstRoute + 1]).to.equal(before[firstRoute]);
        expect(after.slice(firstRoute + 1)).to.deep.equal(before.slice(firstRoute));
      });

      it('appends when no route exists yet, which is still ahead of every route', async () => {
        const app = makeApp();
        const ran: string[] = [];
        app.use((_req: any, _res: any, next: any) => next());
        const result = insertBeforeRoutes(
          app,
          '/wd/hub/session/:sessionId',
          (_req: any, _res: any, next: any) => {
            ran.push('guard');
            next();
          },
        );
        app.get('/wd/hub/session/:sessionId/url', (_req: any, res: any) => {
          ran.push('route');
          res.json({});
        });
        expect(result.placed).to.equal(true);

        await request(await loopback.serve(app))
          .get('/wd/hub/session/abc/url')
          .expect(200);
        expect(ran).to.deep.equal(['guard', 'route']);
      });
    });
  }

  describe('when there is no router to splice into', () => {
    it('says so instead of silently appending after the routes', () => {
      const app: any = { use: () => undefined };
      const result = insertBeforeRoutes(app, '/x', (_req: any, _res: any, next: any) => next());
      expect(result.placed).to.equal(false);
      expect(result.reason).to.match(/router/i);
    });

    it('reports a fresh Express 4 app, whose router does not exist yet', () => {
      // Express 4 creates app._router lazily and throws on app.router. Neither
      // may be mistaken for a router, and the helper must not throw.
      const result = insertBeforeRoutes(express4(), '/x', (_req: any, _res: any, next: any) =>
        next(),
      );
      expect(result.placed).to.equal(false);
    });

    it('does not add a layer when it cannot place it', () => {
      let used = 0;
      const app: any = {
        use: () => {
          used += 1;
        },
      };
      insertBeforeRoutes(app, '/x', (_req: any, _res: any, next: any) => next());
      expect(used).to.equal(0);
    });
  });
});
