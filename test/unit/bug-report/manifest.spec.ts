import { expect } from 'chai';
import { buildManifest } from '../../../src/services/bug-report/manifest';
import { ResolvedWindow } from '../../../src/services/bug-report/types';

const window: ResolvedWindow = {
  startedAt: '2026-04-26T09:54:00.000Z',
  endedAt: '2026-04-26T09:55:00.000Z',
  durationMs: 60000,
  requestedDurationMs: 60000,
};

const session = {
  id: 'sess-1',
  status: 'failed',
  startTime: new Date('2026-04-26T09:50:00.000Z'),
  endTime: new Date('2026-04-26T09:55:00.000Z'),
  device_udid: 'PIXEL7-ABC',
  device_platform: 'android',
  device_name: 'Pixel 7',
  device_version: '14',
  desired_capabilities: JSON.stringify({ app: 'foo.apk', apiKey: 'sk-secret' }),
  failure_reason: 'TimeoutError: element not found',
  ai_analysis: 'The app stalled before login.',
};

describe('buildManifest', () => {
  it('produces schema-stable output', () => {
    const m = buildManifest({
      session: session as any,
      window,
      mode: 'slice',
      xenonVersion: '0.0.0-test',
      generatedAt: '2026-04-26T10:00:00.000Z',
      artifacts: {
        video: 'video.mp4',
        logs: 'logs.txt',
        network: 'network.har',
        aiSummary: 'ai-summary.txt',
        screenshots: ['screenshots/last-frame.png'],
      },
      warnings: [],
    });
    expect(m.schemaVersion).to.equal('1.0');
    expect(m.session.id).to.equal('sess-1');
    expect(m.device.platform).to.equal('android');
    expect(m.window.durationMs).to.equal(60000);
    expect(m.lastCommand?.errorMessage).to.equal('TimeoutError: element not found');
  });

  it('redacts capability secrets', () => {
    const m = buildManifest({
      session: session as any,
      window,
      mode: 'slice',
      xenonVersion: '0.0.0-test',
      generatedAt: '2026-04-26T10:00:00.000Z',
      artifacts: {
        video: null, logs: 'logs.txt', network: null, aiSummary: null, screenshots: [],
      },
      warnings: [],
    });
    expect(JSON.stringify(m.capabilities)).to.not.include('sk-secret');
  });

  it('handles null endTime / status=running', () => {
    const m = buildManifest({
      session: { ...session, endTime: null, status: 'running' } as any,
      window,
      mode: 'slice',
      xenonVersion: '0.0.0-test',
      generatedAt: '2026-04-26T10:00:00.000Z',
      artifacts: {
        video: null, logs: 'logs.txt', network: null, aiSummary: null, screenshots: [],
      },
      warnings: ['video slice failed: ffmpeg exited 1'],
    });
    expect(m.session.endedAt).to.equal(null);
    expect(m.session.durationMs).to.equal(null);
    expect(m.warnings).to.deep.equal(['video slice failed: ffmpeg exited 1']);
  });

  it('passes JSON.stringify round-trip without throwing', () => {
    const m = buildManifest({
      session: session as any,
      window,
      mode: 'full',
      xenonVersion: '0.0.0-test',
      generatedAt: '2026-04-26T10:00:00.000Z',
      artifacts: {
        video: 'video.mp4', logs: 'logs.txt', network: null, aiSummary: null, screenshots: [],
      },
      warnings: [],
    });
    expect(() => JSON.parse(JSON.stringify(m))).to.not.throw();
  });
});
