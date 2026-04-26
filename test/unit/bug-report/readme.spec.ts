import { expect } from 'chai';
import { buildReadme } from '../../../src/services/bug-report/readme';
import { Manifest } from '../../../src/services/bug-report/types';

const M: Manifest = {
  schemaVersion: '1.0',
  generatedAt: '2026-04-26T10:00:00.000Z',
  xenonVersion: '1.2.3',
  mode: 'slice',
  window: {
    startedAt: '2026-04-26T09:59:00.000Z',
    endedAt: '2026-04-26T10:00:00.000Z',
    durationMs: 60000,
    requestedDurationMs: 60000,
  },
  session: {
    id: 'sess-1',
    status: 'failed',
    startedAt: '2026-04-26T09:50:00.000Z',
    endedAt: '2026-04-26T10:00:00.000Z',
    durationMs: 600000,
  },
  device: { udid: 'X', platform: 'android', name: 'Pixel 7', osVersion: '14' },
  capabilities: {},
  lastCommand: { name: 'click', args: null, errorMessage: 'TimeoutError' },
  artifacts: {
    video: 'video.mp4',
    logs: 'logs.txt',
    network: 'network.har',
    aiSummary: 'ai-summary.txt',
    screenshots: [],
  },
  warnings: [],
};

describe('buildReadme', () => {
  it('renders core fields', () => {
    const out = buildReadme(M, 'The app stalled before login.');
    expect(out).to.include('# Xenon Bug Report');
    expect(out).to.include('sess-1');
    expect(out).to.include('Pixel 7');
    expect(out).to.include('Android 14');
    expect(out).to.include('slice');
    expect(out).to.include('The app stalled before login.');
    expect(out).to.include('TimeoutError');
  });

  it('handles missing AI summary', () => {
    const out = buildReadme(M, null);
    expect(out).to.include('(not available)');
  });
});
