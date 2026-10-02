import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import {
  FLUSH_INTERVAL_MS,
  MAX_BUFFERED_SAMPLES,
  SAMPLE_INTERVAL_MS,
  MetricSample,
  MetricsSampler,
  SamplerHooks,
} from '../../src/services/metrics/types';

class FakeSampler implements MetricsSampler {
  started = false;
  stopped = false;
  constructor(public hooks: SamplerHooks) {}
  start() {
    this.started = true;
  }
  async stop() {
    this.stopped = true;
  }
}

class TestMetrics extends SessionMetricsService {
  args: Record<string, unknown> = {};
  written: Array<{ sessionId: string; ats: number[] }> = [];
  failWrites = 0;
  samplers: FakeSampler[] = [];
  caps: unknown[] = [];
  protected context(): any {
    return {
      pluginArgs: { bindHostOrIp: '127.0.0.1', ...this.args },
      port: 4723,
      nodeId: 'node-1',
    };
  }
  protected async writeSamples(sessionId: string, samples: MetricSample[]): Promise<void> {
    if (this.failWrites > 0) {
      this.failWrites -= 1;
      throw new Error('FOREIGN KEY constraint failed');
    }
    this.written.push({ sessionId, ats: samples.map((s) => s.at) });
  }
  protected samplerFor(_id: string, _d: any, caps: Record<string, any>, hooks: SamplerHooks) {
    this.caps.push(caps);
    const f = new FakeSampler(hooks);
    this.samplers.push(f);
    return f;
  }
}

const phone = (over: Record<string, unknown> = {}): any => ({
  udid: 'phone-1',
  platform: 'android',
  realDevice: true,
  host: 'http://127.0.0.1:4723',
  nodeId: 'node-1',
  ...over,
});
const sample = (at: number): MetricSample => ({
  at,
  deviceCpuPct: 10,
  deviceMemMb: 1,
  deviceMemTotalMb: 2,
  appCpuPct: null,
  appMemMb: null,
  appId: null,
});

describe('SessionMetricsService', () => {
  let clock: sinon.SinonFakeTimers;
  let m: TestMetrics;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 1_000_000 });
    m = new TestMetrics();
  });
  afterEach(() => clock.restore());

  it("samples this server's Android phones (emulators too) and iPhones, not simulators", () => {
    expect(m.appliesTo(phone())).to.equal(true);
    expect(m.appliesTo(phone({ realDevice: false }))).to.equal(true);
    expect(m.appliesTo(phone({ platform: 'ios' }))).to.equal(true);
    expect(m.appliesTo(phone({ platform: 'ios', realDevice: false }))).to.equal(false);
    expect(m.appliesTo(undefined)).to.equal(false);
  });

  it("doesn't sample another server's phone, or anything when sessionMetrics is off", () => {
    expect(m.appliesTo(phone({ nodeId: 'node-2' }))).to.equal(false);
    m.args = { sessionMetrics: false };
    expect(m.appliesTo(phone())).to.equal(false);
  });

  it('writes the samples every 10 s, and the rest when the session stops', async () => {
    m.start({ sessionId: 's1', device: phone(), capabilities: { 'appium:appPackage': 'com.a.b' } });
    const hooks = m.samplers[0].hooks;
    expect(m.samplers[0].started).to.equal(true);
    expect(m.caps).to.deep.equal([{ 'appium:appPackage': 'com.a.b' }]);
    [1, 2, 3].forEach((t) => hooks.onSample(sample(t)));
    await clock.tickAsync(FLUSH_INTERVAL_MS);
    [4, 5].forEach((t) => hooks.onSample(sample(t)));
    await m.stop('s1');

    expect(m.written).to.deep.equal([
      { sessionId: 's1', ats: [1, 2, 3] },
      { sessionId: 's1', ats: [4, 5] },
    ]);
    expect(m.samplers[0].stopped).to.equal(true);
  });

  it('keeps samples whose write failed, in order, for the next write', async () => {
    m.start({ sessionId: 's1', device: phone(), capabilities: {} });
    const hooks = m.samplers[0].hooks;
    m.failWrites = 1;
    [1, 2].forEach((t) => hooks.onSample(sample(t)));
    await clock.tickAsync(FLUSH_INTERVAL_MS);
    hooks.onSample(sample(3));
    await clock.tickAsync(FLUSH_INTERVAL_MS);
    await m.stop('s1');

    expect(m.written).to.deep.equal([{ sessionId: 's1', ats: [1, 2, 3] }]);
  });

  it('keeps only the newest samples while writes keep failing', async () => {
    m.start({ sessionId: 's1', device: phone(), capabilities: {} });
    const hooks = m.samplers[0].hooks;
    m.failWrites = 1;
    for (let t = 1; t <= MAX_BUFFERED_SAMPLES + 5; t += 1) hooks.onSample(sample(t));
    await clock.tickAsync(FLUSH_INTERVAL_MS);
    await m.stop('s1');

    const ats = m.written[0].ats;
    expect(ats).to.have.length(MAX_BUFFERED_SAMPLES);
    expect(ats[0]).to.equal(6);
    expect(ats[ats.length - 1]).to.equal(MAX_BUFFERED_SAMPLES + 5);
  });

  it('drops a sample that arrives after the session stopped', async () => {
    m.start({ sessionId: 's1', device: phone(), capabilities: {} });
    const hooks = m.samplers[0].hooks;
    await m.stop('s1');
    hooks.onSample(sample(9));
    await clock.tickAsync(FLUSH_INTERVAL_MS * 2);

    expect(m.written).to.deep.equal([]);
  });

  it('stops twice, or a session it never sampled, without complaint', async () => {
    m.start({ sessionId: 's1', device: phone(), capabilities: {} });
    await m.stop('s1');
    await m.stop('s1');
    await m.stop('never-started');
    expect(m.samplers).to.have.length(1);
  });

  it('says whether it is sampling a session, stopped after giving up, or not at all', () => {
    expect(m.recordingState('s1')).to.equal('off');
    m.start({ sessionId: 's1', device: phone(), capabilities: {} });
    expect(m.recordingState('s1')).to.equal('sampling');
    m.samplers[0].hooks.onGiveUp('device offline');
    expect(m.recordingState('s1')).to.equal('stopped');
  });

  it("doesn't start a sampler for a phone it doesn't apply to", () => {
    m.start({ sessionId: 's2', device: phone({ nodeId: 'node-2' }), capabilities: {} });
    expect(m.samplers).to.deep.equal([]);
  });
});

/** The real Android wiring, down to the adb process it runs. */
class WiredMetrics extends SessionMetricsService {
  calls: string[][] = [];
  protected context(): any {
    return { pluginArgs: { bindHostOrIp: '127.0.0.1' }, port: 4723, nodeId: 'node-1' };
  }
  protected async writeSamples(): Promise<void> {
    // nothing stored
  }
  protected async adbCommand(udid: string): Promise<{ path: string; base: string[] }> {
    return { path: '/sdk/platform-tools/adb', base: ['-P', '5037', '-s', udid] };
  }
  protected async execAdb(path: string, args: string[]): Promise<string> {
    this.calls.push([path, ...args]);
    return args.includes('dumpsys activity activities')
      ? ''
      : 'cpu  100 0 0 50 0 0 0 0 0 0\nMemTotal: 1024 kB\nMemAvailable: 512 kB\n';
  }
}

describe("SessionMetricsService: the Android sampler's adb calls", () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 1_000_000 });
  });
  afterEach(() => clock.restore());

  it('names the phone in every adb call, so a server with several phones reaches the right one', async () => {
    const m = new WiredMetrics();
    m.start({ sessionId: 's-adb', device: phone(), capabilities: {} });
    await clock.tickAsync(0);
    await clock.tickAsync(SAMPLE_INTERVAL_MS);
    await m.stop('s-adb');

    expect(m.calls.length).to.be.greaterThan(1);
    for (const call of m.calls) {
      expect(call.slice(0, 6)).to.deep.equal([
        '/sdk/platform-tools/adb',
        '-P',
        '5037',
        '-s',
        'phone-1',
        'shell',
      ]);
    }
  });
});
