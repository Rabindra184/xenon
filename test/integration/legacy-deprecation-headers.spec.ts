import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';

describe('legacy /reservation headers', () => {
  it('GET /reservation returns Deprecation + Sunset + Link headers', async () => {
    const router = (await import('../../src/app/routers/reservation')).default;
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.apiKey = { id: 'a', scopes: ['devices'] };
      req.auth = { teamIds: ['t'], role: 'MEMBER' };
      next();
    });
    app.use('/reservation', router);
    const res = await request(app).get('/reservation');
    expect(res.headers['deprecation']).to.equal('true');
    expect(res.headers['sunset']).to.match(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.headers['link']).to.include('rel="alternate"');
  });
});
