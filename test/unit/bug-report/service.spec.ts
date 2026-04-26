import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { BugReportService } from '../../../src/services/bug-report/BugReportService';
import { prisma } from '../../../src/prisma';

const FIXTURE_SESSION = {
  id: 'sess-1',
  status: 'failed',
  startTime: new Date('2026-04-26T09:50:00.000Z'),
  endTime: new Date('2026-04-26T09:55:00.000Z'),
  device_udid: 'PIXEL7-ABC',
  device_platform: 'android',
  device_name: 'Pixel 7',
  device_version: '14',
  desired_capabilities: '{"app":"foo.apk"}',
  failure_reason: 'TimeoutError',
  ai_analysis: 'AI says bad UI.',
  video_recording: null,
};

describe('BugReportService', () => {
  afterEach(() => sinon.restore());

  it('throws when session not found', async () => {
    sinon.stub(prisma.session as any, 'findUnique').resolves(null);
    const svc = Container.get(BugReportService);
    let err: Error | null = null;
    try {
      await svc.assemble({ sessionId: 'missing', mode: 'full' });
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).to.include('not found');
  });

  it('returns assembled bundle with manifest, README, logs entry', async () => {
    sinon.stub(prisma.session as any, 'findUnique').resolves(FIXTURE_SESSION);
    sinon.stub(prisma.sessionLog as any, 'findMany').resolves([
      { createdAt: new Date('2026-04-26T09:54:30.000Z'), title: 'click', response: 'ok' },
    ]);
    const svc = Container.get(BugReportService);
    const bundle = await svc.assemble({ sessionId: 'sess-1', mode: 'full' });

    expect(bundle.filename).to.match(/^bugreport-sess-1-.*\.zip$/);
    expect(bundle.entries.find((e) => e.name === 'manifest.json')).to.exist;
    expect(bundle.entries.find((e) => e.name === 'README.md')).to.exist;
    expect(bundle.entries.find((e) => e.name === 'logs.txt')).to.exist;
    expect(bundle.entries.find((e) => e.name === 'ai-summary.txt')).to.exist;
    await bundle.cleanup();
  });
});
