import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import request from '../helpers/loopbackRequest';
import { apiErrorHandler, forwardAsyncErrors } from '../../src/app/apiErrors';
import { createRouter } from '../../src/app/index';
import { config } from '../../src/config';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * Express 4 ignores the promise an async handler returns. A handler that
 * threw after an `await` left the request without an answer until the
 * client gave up, and logged an unhandled rejection: deleting an unknown API
 * key, creating a user whose email exists, a selector lookup with a `%`,
 * another node's status. A synchronous throw got Express's own HTML page,
 * with a stack trace. Every error under /xenon/api now gets a JSON answer.
 */

const prismaError = (code: string, meta: Record<string, unknown> = {}) =>
  Object.assign(new Error(`prisma ${code}`), { code, meta, clientVersion: '5.4.0' });

function appWith(route: express.RequestHandler, method: 'get' | 'post' = 'get') {
  forwardAsyncErrors();
  const app = express();
  app.use(express.json());
  app[method]('/x', route);
  app.use(apiErrorHandler);
  return app;
}

describe('API errors', () => {
  describe('the error handling', () => {
    beforeEach(() => {
      sinon.stub(console, 'error');
    });
    afterEach(() => sinon.restore());

    it('answers an async handler that throws, with JSON', async () => {
      const app = appWith(async () => {
        await Promise.resolve();
        throw new Error('boom: secret detail');
      });
      const r = await request(app).get('/x').timeout(3000);
      expect(r.status).to.equal(500);
      expect(r.body).to.deep.equal({ error: 'internal', message: 'Internal server error' });
      expect(r.text).not.to.include('secret detail');
    });

    it('answers a synchronous throw with JSON, not an HTML stack trace', async () => {
      const app = appWith(() => {
        throw new Error('sync boom');
      });
      const r = await request(app).get('/x').timeout(3000);
      expect(r.status).to.equal(500);
      expect(r.type).to.equal('application/json');
      expect(r.text).not.to.include('at ');
    });

    it('answers a record that does not exist with 404', async () => {
      const app = appWith(async () => {
        throw prismaError('P2025', { cause: 'Record to update not found.' });
      });
      const r = await request(app).get('/x').timeout(3000);
      expect(r.status).to.equal(404);
      expect(r.body).to.deep.equal({ error: 'not_found', message: 'Not found' });
    });

    it('answers a duplicate with 409, naming the field', async () => {
      const app = appWith(async () => {
        throw prismaError('P2002', { target: ['email'] });
      });
      const r = await request(app).get('/x').timeout(3000);
      expect(r.status).to.equal(409);
      expect(r.body).to.deep.equal({ error: 'conflict', message: 'email is already in use' });
    });

    it('answers a malformed % escape with 400', async () => {
      const app = appWith(async () => {
        decodeURIComponent('%E0%A4%A');
      });
      const r = await request(app).get('/x').timeout(3000);
      expect(r.status).to.equal(400);
      expect(r.body.error).to.equal('bad_request');
    });

    it('answers a body that is not JSON with 400', async () => {
      const app = appWith((_req, res) => res.json({ ok: true }), 'post');
      const r = await request(app)
        .post('/x')
        .set('Content-Type', 'application/json')
        .send('{"broken":')
        .timeout(3000);
      expect(r.status).to.equal(400);
      expect(r.body).to.deep.equal({
        error: 'bad_request',
        message: 'The request body is not valid JSON',
      });
    });

    it('keeps a status an error carries (http-errors style)', async () => {
      const app = appWith(async () => {
        throw Object.assign(new Error('Payload too large'), { status: 413, expose: true });
      });
      const r = await request(app).get('/x').timeout(3000);
      expect(r.status).to.equal(413);
      expect(r.body).to.deep.equal({ error: 'Payload too large' });
    });

    it('ends a response that had already started instead of leaving it open', async () => {
      const app = appWith(async (_req, res) => {
        res.status(200).write('partial');
        await Promise.resolve();
        throw new Error('after headers');
      });
      const r = await request(app).get('/x').timeout(3000).buffer(true);
      expect(r.status).to.equal(200);
    });

    it('leaves a handler that answered normally alone', async () => {
      const app = appWith(async (_req, res) => {
        await Promise.resolve();
        res.json({ fine: true });
      });
      const r = await request(app).get('/x').timeout(3000);
      expect(r.status).to.equal(200);
      expect(r.body).to.deep.equal({ fine: true });
    });
  });

  describe('the routes that hung', () => {
    useScratchDatabase();
    let app: express.Express;
    let savedAuthDisabled: boolean | undefined;

    before(() => {
      app = express();
      app.use('/xenon', createRouter({ bindHostOrIp: '127.0.0.1', enableDashboard: true } as any));
    });
    beforeEach(() => {
      savedAuthDisabled = config.authDisabled;
      // Every caller is a synthetic SUPER_ADMIN, and no same-origin check.
      config.authDisabled = true;
      sinon.stub(console, 'error');
    });
    afterEach(() => {
      config.authDisabled = savedAuthDisabled as boolean;
      sinon.restore();
    });

    it('DELETE /api/apikeys/:id with an unknown id answers 404', async () => {
      const r = await request(app).delete('/xenon/api/apikeys/no-such-key').timeout(5000);
      expect(r.status).to.equal(404);
      expect(r.body.error).to.equal('not_found');
    });

    it('POST /api/users with an email already in use answers 409', async () => {
      const body = {
        email: 'dup@example.com',
        name: 'Dup',
        role: 'MEMBER',
        password: 'longenough',
      };
      const first = await request(app).post('/xenon/api/users').send(body).timeout(5000);
      expect(first.status).to.equal(201);
      const again = await request(app).post('/xenon/api/users').send(body).timeout(5000);
      expect(again.status).to.equal(409);
      expect(again.body).to.deep.equal({ error: 'conflict', message: 'email is already in use' });
    });

    it('GET /api/healing/state/:strategy/:value reads a selector with a % once-encoded', async () => {
      const value = "//*[@text='50% off']";
      const r = await request(app)
        .get(`/xenon/api/healing/state/xpath/${encodeURIComponent(value)}`)
        .timeout(5000);
      expect(r.status).to.equal(200);
      expect(r.body).to.deep.equal({ state: null });
    });

    it('GET /api/node/:host/status for another host with no devices answers 404', async () => {
      const r = await request(app).get('/xenon/api/node/10.9.9.9:4723/status').timeout(5000);
      expect(r.status).to.equal(404);
    });
  });
});
