import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authPublicRouter } from '../../src/app/routers/auth';

describe('login rate limit', function () {
  this.timeout(15_000);

  it('5 bad logins from one IP → 6th returns 429 with Retry-After', async () => {
    const app = express();
    app.use(express.json());
    app.use('/auth', authPublicRouter());

    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', '9.9.9.9')
        .send({ email: 'no@no.com', password: 'no' });
      expect(r.status).to.equal(401);
    }
    const blocked = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', '9.9.9.9')
      .send({ email: 'no@no.com', password: 'no' });
    expect(blocked.status).to.equal(429);
    expect(blocked.headers['retry-after']).to.match(/^\d+$/);
  });
});
