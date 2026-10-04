import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { authPublicRouter } from '../../src/app/routers/auth';
import { useScratchDatabase } from '../helpers/scratch-database';

describe('forgot-password rate limit', function () {
  this.timeout(15_000);
  // Each attempt looks the email address up.
  useScratchDatabase({ wholeSuite: true });

  it('3 attempts from one IP -> 4th returns 429 with Retry-After', async () => {
    const app = express();
    app.use(express.json());
    app.use('/auth', authPublicRouter());

    for (let i = 0; i < 3; i++) {
      const r = await request(app)
        .post('/auth/forgot-password')
        .set('X-Forwarded-For', '7.7.7.7')
        .send({ email: 'whatever@xenon.local' });
      expect(r.status).to.equal(204);
    }
    const blocked = await request(app)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', '7.7.7.7')
      .send({ email: 'whatever@xenon.local' });
    expect(blocked.status).to.equal(429);
    expect(blocked.headers['retry-after']).to.match(/^\d+$/);
  });
});
