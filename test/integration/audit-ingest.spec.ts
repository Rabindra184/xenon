import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
// Static import (matches the passing integration-spec idiom, e.g. selector-health-endpoint.spec):
// a dynamic `await import('...routers/audit')` fails ESM resolution on the extensionless path
// under this repo's ts-node setup.
import { makeRouter, auditRouter } from '../../src/app/routers/audit';

describe('POST /xenon/api/audit/events', () => {
  let app: express.Express;
  let eventLogSvc: any;

  beforeEach(() => {
    eventLogSvc = { appendSafe: sinon.stub() };

    app = express();
    app.use(express.json());
    // Stub req.apiKey + req.auth that the auth middleware would normally set.
    app.use((req: any, _res, next) => {
      req.apiKey = { id: 'actor-1', teamId: 'team-1' };
      req.auth = { role: 'MEMBER', scopes: 'admin', teamId: 'team-1' };
      next();
    });
    app.use('/xenon/api/audit', makeRouter({ eventLogService: eventLogSvc }));
  });

  it('202s on a valid batch of 2 events and appends each via EventLogService.appendSafe with type mcp_audit', async () => {
    const res = await request(app)
      .post('/xenon/api/audit/events')
      .send({
        events: [
          { subject: 'agent-1', tool: 'xenon_list_devices', decision: 'allow', latencyMs: 12 },
          {
            subject: 'agent-1',
            tool: 'xenon_acquire_device',
            decision: 'allow',
            latencyMs: 45,
            correlationId: 'corr-1',
            sessionId: 'sess-1',
          },
        ],
      });

    expect(res.status).to.equal(202);
    expect(res.body).to.deep.equal({ ingested: 2 });

    expect(eventLogSvc.appendSafe.calledTwice).to.be.true;
    const firstArg = eventLogSvc.appendSafe.firstCall.args[0];
    expect(firstArg.type).to.equal('mcp_audit');
    expect(firstArg.payload).to.deep.include({
      subject: 'agent-1',
      tool: 'xenon_list_devices',
      decision: 'allow',
      latencyMs: 12,
    });
    expect(firstArg.teamId).to.equal('team-1');

    const secondArg = eventLogSvc.appendSafe.secondCall.args[0];
    expect(secondArg.type).to.equal('mcp_audit');
    expect(secondArg.correlationId).to.equal('corr-1');
    expect(secondArg.payload).to.deep.include({ sessionId: 'sess-1' });
  });

  it('400s when events is missing', async () => {
    const res = await request(app).post('/xenon/api/audit/events').send({});
    expect(res.status).to.equal(400);
    expect(res.body.error).to.equal('bad_request');
    expect(eventLogSvc.appendSafe.called).to.be.false;
  });

  it('400s when events is not an array', async () => {
    const res = await request(app)
      .post('/xenon/api/audit/events')
      .send({ events: 'nope' });
    expect(res.status).to.equal(400);
    expect(res.body.error).to.equal('bad_request');
  });

  it('400s when a batch event is malformed (missing tool)', async () => {
    const res = await request(app)
      .post('/xenon/api/audit/events')
      .send({
        events: [{ subject: 'agent-1', decision: 'allow', latencyMs: 10 }],
      });
    expect(res.status).to.equal(400);
    expect(res.body.error).to.equal('bad_request');
    expect(res.body.details).to.be.a('string');
    expect(eventLogSvc.appendSafe.called).to.be.false;
  });

  it('400s when the batch exceeds the size cap', async () => {
    const events = Array.from({ length: 1001 }, (_, i) => ({
      subject: 'agent-1',
      tool: 'xenon_list_devices',
      decision: 'allow',
      latencyMs: i,
    }));
    const res = await request(app).post('/xenon/api/audit/events').send({ events });
    expect(res.status).to.equal(400);
    expect(res.body.error).to.equal('bad_request');
    expect(eventLogSvc.appendSafe.called).to.be.false;
  });
});

describe('POST /xenon/api/audit/events — guard (router-level roleGuard(MEMBER) + mutationScopeGuard(admin))', () => {
  function makeApp(eventLogSvc: any) {
    return () => {
      const app = express();
      app.use(express.json());
      app.use((req: any, _res, next) => {
        const role = req.headers['x-test-role'];
        const scopes = req.headers['x-test-scopes'];
        if (role) req.auth = { role, scopes: scopes ?? '' };
        next();
      });
      app.use('/xenon/api/audit', auditRouter({ eventLogService: eventLogSvc }));
      return app;
    };
  }

  const validBody = {
    events: [{ subject: 'agent-1', tool: 'xenon_list_devices', decision: 'allow', latencyMs: 1 }],
  };

  let eventLogSvc: any;
  beforeEach(() => {
    eventLogSvc = { appendSafe: sinon.stub() };
  });

  it('401s when unauthenticated', async () => {
    const app = await makeApp(eventLogSvc)();
    const res = await request(app).post('/xenon/api/audit/events').send(validBody);
    expect(res.status).to.equal(401);
  });

  it('403s for a role below MEMBER', async () => {
    const app = await makeApp(eventLogSvc)();
    const res = await request(app)
      .post('/xenon/api/audit/events')
      .set('x-test-role', 'BOGUS')
      .set('x-test-scopes', 'admin')
      .send(validBody);
    expect(res.status).to.equal(403);
  });

  it('403s for MEMBER role without the admin scope', async () => {
    const app = await makeApp(eventLogSvc)();
    const res = await request(app)
      .post('/xenon/api/audit/events')
      .set('x-test-role', 'MEMBER')
      .set('x-test-scopes', 'devices')
      .send(validBody);
    expect(res.status).to.equal(403);
    expect(eventLogSvc.appendSafe.called).to.be.false;
  });

  it('202s for MEMBER role with the admin scope', async () => {
    const app = await makeApp(eventLogSvc)();
    const res = await request(app)
      .post('/xenon/api/audit/events')
      .set('x-test-role', 'MEMBER')
      .set('x-test-scopes', 'admin')
      .send(validBody);
    expect(res.status).to.equal(202);
    expect(eventLogSvc.appendSafe.calledOnce).to.be.true;
  });
});
