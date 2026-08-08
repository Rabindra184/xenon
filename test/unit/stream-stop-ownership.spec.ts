import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import ControlRouter from '../../src/app/routers/control';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceService from '../../src/data-service/device-service';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';
import { scopesForRole } from '../../src/middleware/authMiddleware';

/**
 * Round-trip guard for POST /control/:udid/stream/stop.
 *
 * The pure-function spec (stream-start-conflict.spec.ts) proved START refuses
 * to steal a lock, but never drove STOP — and that is precisely where the
 * branch broke. stream/start writes formatManualLock(req.auth.userId, udid);
 * stream/stop used to read `req.apiKey?.id ?? auth.userId`. On the header-pair
 * credential path authMiddleware sets BOTH, in different id spaces, so the
 * caller who had just started the stream got 403 lock_owned_by_another_user on
 * their own device — before stopStream() ran, so the capture pipeline stayed up
 * and `busy` stayed true (permanently on iOS: the idle watchdog refuses to stop
 * a stream while the device is busy).
 *
 * These tests drive the REAL control router over HTTP, so the two sides of the
 * lock (writer basis vs reader basis) are exercised together.
 */

const UDID = 'DEV-1';
const ALICE = 'usr_alice';
const BOB = 'usr_bob';
const ALICE_KEY = 'key_abc';

interface Caller {
  userId?: string;
  role?: 'MEMBER' | 'ADMIN' | 'SUPER_ADMIN';
  scopes?: string;
  /** Set to emulate the header-pair credential path (req.apiKey populated). */
  apiKeyId?: string;
  kind?: 'api-key' | 'user-session' | 'bearer';
}

function buildApp(caller: Caller) {
  const app = express();
  app.use(express.json());
  const apiRouter = express.Router();
  apiRouter.use((req, _res, next) => {
    if (caller.userId) {
      const role = caller.role ?? 'MEMBER';
      (req as any).auth = {
        kind: caller.kind ?? (caller.apiKeyId ? 'api-key' : 'user-session'),
        userId: caller.userId,
        role,
        scopes: caller.scopes ?? (role === 'MEMBER' ? 'devices' : scopesForRole(role)),
        apiKeyId: caller.apiKeyId,
        rateLimit: 100,
      };
      // authMiddleware populates req.apiKey ONLY on the api-key header-pair
      // path — and with the ApiKey row id, a different id space from userId.
      if (caller.apiKeyId) {
        (req as any).apiKey = {
          id: caller.apiKeyId,
          scopes: caller.scopes ?? 'devices',
          rateLimit: 100,
        };
      }
    }
    next();
  });
  ControlRouter.register(apiRouter);
  app.use('/xenon/api', apiRouter);
  return app;
}

describe('POST /control/:udid/stream/stop — lock ownership round-trip', () => {
  let unblock: sinon.SinonStub;
  let androidStop: sinon.SinonStub;
  let h264Stop: sinon.SinonStub;
  let deviceRow: any;

  function setLock(sessionId: string | null) {
    deviceRow = {
      udid: UDID,
      host: '127.0.0.1',
      platform: 'android',
      busy: sessionId !== null,
      session_id: sessionId,
    };
  }

  beforeEach(() => {
    setLock(`manual_${ALICE}_${UDID}`);
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async () => deviceRow,
    } as any);
    unblock = sinon.stub(deviceService, 'unblockDevice').resolves();
    androidStop = sinon.stub().resolves();
    h264Stop = sinon.stub().resolves();
    Container.set(ApiKeyService, new ApiKeyService());
    Container.set(AndroidStreamService, { stopStream: androidStop } as any);
    Container.set(AndroidH264StreamService, { stop: h264Stop } as any);
    Container.set(IOSStreamService, { stopStream: sinon.stub().resolves() } as any);
  });

  afterEach(() => {
    sinon.restore();
    Container.reset();
  });

  const stop = (caller: Caller) =>
    request(buildApp(caller)).post(`/xenon/api/control/${UDID}/stream/stop`);

  it('CRITICAL: the header-pair caller who started the stream can stop it', async () => {
    // Exactly what stream/start wrote for this caller: manual_<userId>_<udid>.
    // req.apiKey.id is set and DIFFERENT — the pre-fix reader picked it and 403'd.
    const res = await stop({ userId: ALICE, apiKeyId: ALICE_KEY });
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(res.body).to.deep.equal({ success: true });
    // The capture pipeline is actually torn down, not just the HTTP 200.
    expect(androidStop.calledOnceWith(UDID)).to.equal(true);
    expect(h264Stop.calledOnceWith(UDID)).to.equal(true);
    // ...and the device is released, so it does not stay busy forever.
    expect(unblock.calledOnce).to.equal(true);
    expect(unblock.firstCall.args[0]).to.equal(UDID);
  });

  it('a cookie session for the same user can stop it too (no req.apiKey at all)', async () => {
    const res = await stop({ userId: ALICE });
    expect(res.status).to.equal(200);
    expect(unblock.calledOnce).to.equal(true);
  });

  it('a genuinely different user still gets 403 and nothing is torn down', async () => {
    const res = await stop({ userId: BOB, apiKeyId: 'key_bob' });
    expect(res.status).to.equal(403);
    expect(res.body.error).to.equal('lock_owned_by_another_user');
    expect(androidStop.called).to.equal(false);
    expect(h264Stop.called).to.equal(false);
    expect(unblock.called).to.equal(false);
  });

  it('a cookie ADMIN can force-release another user’s lock', async () => {
    // scopesForRole('ADMIN') grants `admin` but NOT role SUPER_ADMIN, and a
    // cookie session never populates req.apiKey — the pre-fix check read
    // req.apiKey.scopes, so the documented recovery path 403'd.
    const res = await stop({ userId: BOB, role: 'ADMIN' });
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(unblock.calledOnce).to.equal(true);
  });

  it('a SUPER_ADMIN can still force-release', async () => {
    const res = await stop({ userId: BOB, role: 'SUPER_ADMIN' });
    expect(res.status).to.equal(200);
    expect(unblock.calledOnce).to.equal(true);
  });

  it('a scope merely containing "admin" (nonadmin) does NOT grant force-release', async () => {
    const res = await stop({ userId: BOB, scopes: 'nonadmin,devices' });
    expect(res.status).to.equal(403);
    expect(unblock.called).to.equal(false);
  });

  it('a legacy ownerless manual_<udid> lock can still be released by anyone', async () => {
    setLock(`manual_${UDID}`);
    const res = await stop({ userId: BOB });
    expect(res.status).to.equal(200);
    expect(unblock.calledOnce).to.equal(true);
  });

  it('recognises a lock left behind keyed on the caller’s apiKey id (upgrade tolerance)', async () => {
    setLock(`manual_${ALICE_KEY}_${UDID}`);
    const res = await stop({ userId: ALICE, apiKeyId: ALICE_KEY });
    expect(res.status).to.equal(200);
    expect(unblock.calledOnce).to.equal(true);
  });

  it('an Appium session id is not a manual lock: stop proceeds but releases nothing', async () => {
    setLock('appium-session-1');
    const res = await stop({ userId: BOB });
    expect(res.status).to.equal(200);
    expect(androidStop.calledOnce).to.equal(true);
    expect(unblock.called).to.equal(false);
  });
});
