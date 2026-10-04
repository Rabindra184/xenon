import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as unzipper from 'unzipper';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';
import bugReportRouter from '../../src/app/routers/bug-report';
import { scopesForRole } from '../../src/middleware/authMiddleware';

describe('POST /sessions/:id/bug-report (integration)', () => {
  let tmpAssets: string;
  let savedAssetsPath: string;
  const fixtureMp4 = path.join(__dirname, 'fixtures/bug-report/recording.mp4');

  beforeEach(() => {
    tmpAssets = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-it-'));
    savedAssetsPath = config.sessionAssetsPath;
    (config as any).sessionAssetsPath = tmpAssets;
    const sessionDir = path.join(tmpAssets, 'sess-it', 'video');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.copyFileSync(fixtureMp4, path.join(sessionDir, 'sess-it.mp4'));
  });

  afterEach(() => {
    sinon.restore();
    (config as any).sessionAssetsPath = savedAssetsPath;
    fs.rmSync(tmpAssets, { recursive: true, force: true });
  });

  /**
   * The router sits behind authMiddleware in the API, and its roleGuard
   * answers 401 to a request with no `req.auth` (27fd825, three days after
   * this spec). Stand in for the middleware with an admin, as it sets one:
   * no `teamIds`, so the session needs no Device row to be visible.
   */
  function makeApp() {
    const app = express();
    app.use((req: any, _res, next) => {
      req.auth = {
        kind: 'user-session',
        userId: 'usr_admin',
        role: 'ADMIN',
        scopes: scopesForRole('ADMIN'),
        rateLimit: 100,
      };
      next();
    });
    bugReportRouter.register(app as any);
    return app;
  }

  it('returns a valid zip with manifest, README, logs, video for mode=full', async () => {
    sinon.stub(prisma.session as any, 'findUnique').resolves({
      id: 'sess-it',
      status: 'failed',
      startTime: new Date(Date.now() - 60_000),
      endTime: new Date(),
      device_udid: 'X',
      device_platform: 'android',
      device_name: 'Pixel',
      device_version: '14',
      desired_capabilities: '{"app":"foo.apk","apiKey":"sk-secret"}',
      failure_reason: 'TimeoutError',
      ai_analysis: 'AI says bad UI.',
      video_recording: 'sess-it/video/sess-it.mp4',
    });
    sinon.stub(prisma.sessionLog as any, 'findMany').resolves([
      { createdAt: new Date(), title: 'click', response: 'fail' },
    ]);

    const res = await request(makeApp())
      .post('/sessions/sess-it/bug-report?mode=full')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c as Buffer));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).to.equal(200);
    const dir = await unzipper.Open.buffer(res.body);
    const names = dir.files.map((f) => f.path).sort();
    expect(names).to.include.members([
      'README.md',
      'ai-summary.txt',
      'logs.txt',
      'manifest.json',
      'video.mp4',
    ]);

    const manifestEntry = dir.files.find((f) => f.path === 'manifest.json')!;
    const manifestBuf = await manifestEntry.buffer();
    const manifest = JSON.parse(manifestBuf.toString('utf8'));
    expect(manifest.schemaVersion).to.equal('1.0');
    expect(manifest.session.id).to.equal('sess-it');
    expect(JSON.stringify(manifest.capabilities)).to.not.include('sk-secret');

    const videoEntry = dir.files.find((f) => f.path === 'video.mp4')!;
    expect(videoEntry.uncompressedSize).to.be.greaterThan(0);
  });
});
