import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import {
  LoginRateLimiter,
  loginRateLimitMiddleware,
  ipHashOf,
  MAX_LOGIN_BUCKETS,
} from '../../src/middleware/loginRateLimiter';

// The sign-in limit is keyed on the caller's address. Through 2.36 it was the
// first entry of the caller's own X-Forwarded-For header, so a client that
// sent a new one with each attempt was never limited, and every new value
// added a bucket that was never removed.

function appWith(limiter: LoginRateLimiter, trustProxy?: string | number) {
  const app = express();
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
  app.post('/login', loginRateLimitMiddleware(limiter), (req, res) =>
    res.status(401).json({ key: (req as any).loginRateLimitKey }),
  );
  return app;
}

describe('login rate limit key', () => {
  it('a rotating X-Forwarded-For does not reset the limit when no proxy is trusted', async () => {
    const app = appWith(new LoginRateLimiter({ attempts: 3, windowMs: 60_000 }));
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/login')
        .set('X-Forwarded-For', `198.51.100.${i + 1}`);
      statuses.push(res.status);
    }
    expect(statuses).to.deep.equal([401, 401, 401, 429, 429]);
  });

  it('keys on the socket address, whatever X-Forwarded-For says, when no proxy is trusted', async () => {
    const app = appWith(new LoginRateLimiter({ attempts: 10, windowMs: 60_000 }));
    const a = await request(app).post('/login').set('X-Forwarded-For', '198.51.100.1');
    const b = await request(app).post('/login');
    expect(a.body.key).to.be.a('string').and.equal(b.body.key);
  });

  it('behind a trusted proxy, keys on the address the proxy saw', async () => {
    const app = appWith(new LoginRateLimiter({ attempts: 10, windowMs: 60_000 }), 'loopback');
    const one = await request(app).post('/login').set('X-Forwarded-For', '203.0.113.7');
    const again = await request(app).post('/login').set('X-Forwarded-For', '203.0.113.7');
    const other = await request(app).post('/login').set('X-Forwarded-For', '203.0.113.8');
    const direct = await request(app).post('/login');
    expect(one.body.key).to.equal(again.body.key);
    expect(one.body.key).to.not.equal(other.body.key);
    expect(one.body.key).to.not.equal(direct.body.key);
  });

  it('behind one trusted proxy, an address the client put in front of the chain is not used', () => {
    const app = express();
    app.set('trust proxy', 1);
    const reqLike = (xff: string) => {
      const req: any = Object.create(app.request);
      req.app = app;
      req.headers = { 'x-forwarded-for': xff };
      req.socket = { remoteAddress: '10.0.0.1' };
      req.connection = req.socket;
      return req;
    };
    // The proxy appends the address it saw (203.0.113.9); the client wrote the rest.
    expect(ipHashOf(reqLike('198.51.100.1, 203.0.113.9'))).to.equal(
      ipHashOf(reqLike('198.51.100.2, 203.0.113.9')),
    );
  });

  it('holds at most MAX_LOGIN_BUCKETS buckets', () => {
    const r = new LoginRateLimiter({ attempts: 3, windowMs: 60_000 });
    for (let i = 0; i < MAX_LOGIN_BUCKETS + 500; i++) r.consume(`key-${i}`);
    expect(r.size()).to.be.at.most(MAX_LOGIN_BUCKETS);
    // The newest keys are the ones kept.
    expect(r.retryAfterSec(`key-${MAX_LOGIN_BUCKETS + 499}`)).to.be.greaterThan(0);
  });

  it('drops expired buckets as new ones arrive', async () => {
    const r = new LoginRateLimiter({ attempts: 3, windowMs: 10 });
    for (let i = 0; i < 50; i++) r.consume(`old-${i}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
    r.consume('new');
    expect(r.size()).to.equal(1);
  });
});
