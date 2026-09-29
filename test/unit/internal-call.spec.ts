import { expect } from 'chai';
import path from 'path';
import sinon from 'sinon';
import express4 from 'express';
import request from '../helpers/loopbackRequest';
import { CommandCallerVerifier } from '../../src/middleware/commandCaller';
import { registerCommandAuth } from '../../src/app/registerCommandAuth';
import { routerStackOf } from '../../src/app/insertBeforeRoutes';
import {
  INTERNAL_CALL_HEADER,
  hasInternalCallSecret,
  internalCallHeaders,
  internalCallBaseUrl,
} from '../../src/gateway/internalCall';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * Xenon's own loopback calls (`<basePath>/wd-internal/...`).
 *
 * A call that carries this process's secret header is Xenon's own: the
 * `/wd-internal` marker is stripped and the call skips per-command auth. The
 * path alone proves nothing, so without the secret a `/wd-internal` request
 * is left exactly as it came and ends where any unknown route ends.
 */

function appiumExpress(): any {
  const appiumDir = path.dirname(require.resolve('appium/package.json'));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(require.resolve('express', { paths: [appiumDir] }));
}

const shapes: Array<[string, () => any]> = [
  ['Express 4', () => express4()],
  ['Express 5 (Appium 3)', () => appiumExpress()()],
];

// Appium's catch-all, in shape: every unknown route gets the same answer.
const UNKNOWN_ROUTE = {
  value: { error: 'unknown command', message: 'no route', stacktrace: '' },
};

describe('internal calls (/wd-internal with the per-process secret)', () => {
  describe('the secret', () => {
    it('is sent by internalCallHeaders and recognised by hasInternalCallSecret', () => {
      const headers = internalCallHeaders();
      expect(Object.keys(headers)).to.deep.equal([INTERNAL_CALL_HEADER]);
      expect(headers[INTERNAL_CALL_HEADER]).to.have.length.greaterThan(30);
      expect(hasInternalCallSecret(headers)).to.equal(true);
    });

    it('is refused when absent, wrong, a different length, or repeated', () => {
      const secret = internalCallHeaders()[INTERNAL_CALL_HEADER];
      expect(hasInternalCallSecret({})).to.equal(false);
      expect(hasInternalCallSecret({ [INTERNAL_CALL_HEADER]: `${secret.slice(1)}x` })).to.equal(
        false,
      );
      expect(hasInternalCallSecret({ [INTERNAL_CALL_HEADER]: 'short' })).to.equal(false);
      expect(hasInternalCallSecret({ [INTERNAL_CALL_HEADER]: [secret, secret] as any })).to.equal(
        false,
      );
    });

    it('builds the loopback base URL under the normalised base path', () => {
      expect(internalCallBaseUrl('0.0.0.0', 4723, 'wd/hub/')).to.equal(
        'http://127.0.0.1:4723/wd/hub/wd-internal',
      );
      expect(internalCallBaseUrl('10.0.0.5', 4723, '')).to.equal(
        'http://10.0.0.5:4723/wd-internal',
      );
    });
  });

  for (const [shapeName, makeExpress] of shapes) {
    describe(shapeName, () => {
      const loopback = loopbackServers();
      let ran: Array<{ name: string; url: string; secret: unknown }>;
      let ownerOf: sinon.SinonStub;
      let warnings: string[];

      afterEach(() => loopback.closeAll());

      beforeEach(() => {
        ran = [];
        warnings = [];
        ownerOf = sinon.stub().resolves('alice');
      });

      async function lab(basePath = '/wd/hub') {
        const app = makeExpress();
        app.use(express4.json());
        const route = (name: string) => (req: any, res: any) => {
          ran.push({ name, url: req.originalUrl, secret: req.headers[INTERNAL_CALL_HEADER] });
          res.json({ value: req.params.sessionId ?? null });
        };
        app.get(`${basePath}/session/:sessionId/url`, route('getUrl'));
        app.get(`${basePath}/session/:sessionId/timeouts`, route('getTimeouts'));
        app.post(`${basePath}/session`, route('createSession'));
        const result = registerCommandAuth(
          app,
          { basePath },
          {
            enabled: () => true,
            authDisabled: () => false,
            verifier: new CommandCallerVerifier({
              verifyKeyPair: sinon.stub().resolves(null),
              verifyBearer: sinon.stub().resolves(null),
            }),
            ownerOf,
            logger: {
              info: () => undefined,
              warn: (m: string) => warnings.push(m),
              error: () => undefined,
            },
          },
        );
        expect(result.placed).to.equal(true);
        // Appium adds its catch-all after every updater.
        app.use((_req: any, res: any) => res.status(404).json(UNKNOWN_ROUTE));
        return { app: await loopback.serve(app), raw: app };
      }

      it('without the secret, answers a /wd-internal command as an unknown route', async () => {
        const { app } = await lab();
        const internal = await request(app).get('/wd/hub/wd-internal/session/s1/url');
        const unknown = await request(app).get('/wd/hub/no-such-prefix/session/s1/url');
        expect(internal.status).to.equal(404);
        expect(internal.status).to.equal(unknown.status);
        expect(internal.text).to.equal(unknown.text);
        expect(ran).to.deep.equal([]);
      });

      it('with a wrong secret, answers as an unknown route too', async () => {
        const { app } = await lab();
        const res = await request(app)
          .get('/wd/hub/wd-internal/session/s1/url')
          .set(INTERNAL_CALL_HEADER, 'not-the-secret');
        expect(res.status).to.equal(404);
        expect(res.body).to.deep.equal(UNKNOWN_ROUTE);
        expect(ran).to.deep.equal([]);
      });

      it('with the secret, strips the marker and skips per-command auth', async () => {
        const { app } = await lab();
        const res = await request(app)
          .get('/wd/hub/wd-internal/session/s1/timeouts')
          .set(internalCallHeaders());
        expect(res.status).to.equal(200);
        expect(res.body).to.deep.equal({ value: 's1' });
        // The route saw the canonical path and never the secret.
        expect(ran).to.deep.equal([
          { name: 'getTimeouts', url: '/wd/hub/session/s1/timeouts', secret: undefined },
        ]);
        expect(ownerOf.called).to.equal(false);
        expect(warnings).to.deep.equal([]);
      });

      it('the same session command without the marker still needs credentials', async () => {
        const { app } = await lab();
        const res = await request(app).get('/wd/hub/session/s1/url').set(internalCallHeaders());
        expect(res.status).to.equal(404);
        expect(res.body.value.error).to.equal('invalid session id');
        expect(ran).to.deep.equal([]);
      });

      it('works under an empty base path', async () => {
        const { app } = await lab('');
        const res = await request(app)
          .get('/wd-internal/session/s1/url')
          .set(internalCallHeaders());
        expect(res.status).to.equal(200);
        expect(ran.map((r) => r.url)).to.deep.equal(['/session/s1/url']);
      });

      it('recognises only the exact marker, never a look-alike', async () => {
        const { app } = await lab();
        for (const url of [
          '/wd/hub/wd-internalx/session/s1/url',
          '/WD/HUB/WD-INTERNAL/session/s1/url',
          '/wd-internal/wd/hub/session/s1/url',
        ]) {
          const res = await request(app).get(url).set(internalCallHeaders());
          expect(res.status, url).to.equal(404);
        }
        expect(ran).to.deep.equal([]);
      });

      it('puts the internal-call layer ahead of the session layer, both ahead of the routes', async () => {
        const { raw } = await lab();
        const stack = routerStackOf(raw) as any[];
        const firstRoute = stack.findIndex((layer) => !!layer.route);
        const names = stack.slice(0, firstRoute).map((layer) => layer.handle?.name);
        const internal = names.indexOf('xenonInternalCalls');
        const gateway = names.indexOf('xenonSessionGateway');
        expect(internal, 'internal-call layer placed').to.be.greaterThan(-1);
        expect(gateway, 'session gateway placed').to.be.greaterThan(internal);
      });
    });
  }
});
