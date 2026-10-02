import { expect } from 'chai';
import { EventEmitter } from 'events';
import sinon from 'sinon';
import { AndroidMetricsSampler } from '../../src/services/metrics/AndroidMetricsSampler';
import { IOSMetricsSampler } from '../../src/services/metrics/IOSMetricsSampler';
import {
  FOREGROUND_REFRESH_MS,
  MAX_CONSECUTIVE_FAILURES,
  MetricSample,
  SAMPLE_INTERVAL_MS,
  TUNNEL_RENEW_MS,
} from '../../src/services/metrics/types';

const reading = (jiffies: number, idle: number, app: number) =>
  [
    `cpu  ${jiffies - idle} 0 0 ${idle} 0 0 0 0 0 0`,
    'MemTotal:        5755748 kB',
    'MemAvailable:    2839168 kB',
    'pid=1404',
    `stat=${app} 0`,
    'VmRSS:\t  334480 kB',
  ].join('\n');

describe('session metrics: AndroidMetricsSampler', () => {
  let clock: sinon.SinonFakeTimers;
  let samples: MetricSample[];
  let gaveUp: string[];
  const hooks = () => ({
    onSample: (s: MetricSample) => samples.push(s),
    onGiveUp: (r: string) => gaveUp.push(r),
  });

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 1_000_000 });
    samples = [];
    gaveUp = [];
  });
  afterEach(() => clock.restore());

  it("samples the session's app every 2 s, with CPU from the second sample", async () => {
    const commands: string[] = [];
    let n = 0;
    const s = new AndroidMetricsSampler({
      appPackage: 'com.acme.shop',
      hooks: hooks(),
      shell: async (c) => {
        commands.push(c);
        n += 1;
        return reading(1000 * n, 800 * n, 50 * n);
      },
    });
    s.start();
    await clock.tickAsync(0);
    await clock.tickAsync(SAMPLE_INTERVAL_MS);
    await s.stop();

    expect(commands).to.have.length(2);
    expect(commands.every((c) => c.includes('pidof com.acme.shop'))).to.equal(true);
    expect(samples.map((x) => x.deviceCpuPct)).to.deep.equal([null, 20]);
    expect(samples.map((x) => x.appCpuPct)).to.deep.equal([null, 5]);
    expect(samples[1].appId).to.equal('com.acme.shop');
  });

  it('with no appPackage, samples the foreground app, looked up once per 10 s', async () => {
    const commands: string[] = [];
    const s = new AndroidMetricsSampler({
      appPackage: undefined,
      hooks: hooks(),
      shell: async (c) => {
        commands.push(c);
        return c.startsWith('dumpsys')
          ? '  topResumedActivity=ActivityRecord{a1 u0 com.acme.shop/.Main t3}'
          : reading(1000, 800, 50);
      },
    });
    s.start();
    await clock.tickAsync(0);
    await clock.tickAsync(SAMPLE_INTERVAL_MS);
    await clock.tickAsync(FOREGROUND_REFRESH_MS);
    await s.stop();

    const lookups = commands.filter((c) => c.startsWith('dumpsys'));
    expect(lookups).to.have.length(2);
    expect(commands.filter((c) => c.includes('pidof com.acme.shop')).length).to.be.greaterThan(2);
  });

  it("never puts an appPackage that isn't a package name into a command", async () => {
    const commands: string[] = [];
    const s = new AndroidMetricsSampler({
      appPackage: 'com.acme;reboot',
      hooks: hooks(),
      shell: async (c) => {
        commands.push(c);
        return c.startsWith('dumpsys') ? '' : reading(1000, 800, 50);
      },
    });
    s.start();
    await clock.tickAsync(0);
    await s.stop();

    expect(commands.some((c) => c.includes('reboot'))).to.equal(false);
    expect(samples[0].appId).to.equal(null);
  });

  it('stops itself after 5 failures in a row, and says so once', async () => {
    let calls = 0;
    const s = new AndroidMetricsSampler({
      appPackage: 'com.acme.shop',
      hooks: hooks(),
      shell: async () => {
        calls += 1;
        throw new Error('device offline');
      },
    });
    s.start();
    await clock.tickAsync(0);
    await clock.tickAsync(SAMPLE_INTERVAL_MS * (MAX_CONSECUTIVE_FAILURES + 3));

    expect(calls).to.equal(MAX_CONSECUTIVE_FAILURES);
    expect(gaveUp).to.deep.equal(['device offline']);
  });

  it('starts counting failures again after a good sample', async () => {
    let n = 0;
    const s = new AndroidMetricsSampler({
      appPackage: 'com.acme.shop',
      hooks: hooks(),
      shell: async () => {
        n += 1;
        if (n % 4 === 0) return reading(1000 * n, 800 * n, 50 * n);
        throw new Error('flaky');
      },
    });
    s.start();
    await clock.tickAsync(0);
    await clock.tickAsync(SAMPLE_INTERVAL_MS * 12);
    await s.stop();

    expect(gaveUp).to.deep.equal([]);
    expect(samples.length).to.equal(3);
  });

  it('reports nothing that was in flight when it stopped', async () => {
    let release: (out: string) => void = () => undefined;
    const s = new AndroidMetricsSampler({
      appPackage: 'com.acme.shop',
      hooks: hooks(),
      shell: () => new Promise<string>((r) => (release = r)),
    });
    s.start();
    await clock.tickAsync(0);
    await s.stop();
    release(reading(1000, 800, 50));
    await clock.tickAsync(SAMPLE_INTERVAL_MS * 3);

    expect(samples).to.deep.equal([]);
  });
});

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4321;
  killed: string[] = [];
  kill(sig: string) {
    this.killed.push(sig);
    return true;
  }
}

describe('session metrics: IOSMetricsSampler', () => {
  let clock: sinon.SinonFakeTimers;
  let samples: MetricSample[];
  let gaveUp: string[];
  let children: FakeChild[];
  let envs: NodeJS.ProcessEnv[];
  let borrows: number;
  const line = (load: number) =>
    JSON.stringify({ msg: 'received CPU usage data', enabled_cpus: 6, cpu_total_load: load }) +
    '\n';

  function sampler() {
    return new IOSMetricsSampler({
      udid: 'iphone-1',
      tunnels: {
        borrow: async () => {
          borrows += 1;
          return 12100;
        },
        envFor: () => ({ GO_IOS_AGENT_PORT: '12100' }),
      },
      spawnSysmontap: (env) => {
        envs.push(env);
        const c = new FakeChild();
        children.push(c);
        return c as any;
      },
      hooks: { onSample: (s) => samples.push(s), onGiveUp: (r) => gaveUp.push(r) },
    });
  }

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 1_000_000 });
    samples = [];
    gaveUp = [];
    children = [];
    envs = [];
    borrows = 0;
  });
  afterEach(() => clock.restore());

  it("runs sysmontap through the phone's tunnel and reports device CPU every 2 s", async () => {
    const s = sampler();
    s.start();
    await clock.tickAsync(0);
    expect(envs).to.deep.equal([{ GO_IOS_AGENT_PORT: '12100' }]);
    children[0].stderr.emit('data', line(60) + line(120));
    await clock.tickAsync(SAMPLE_INTERVAL_MS);
    await s.stop();

    expect(samples).to.have.length(1);
    expect(samples[0]).to.include({
      deviceCpuPct: 20,
      deviceMemMb: null,
      appCpuPct: null,
      appMemMb: null,
      appId: null,
    });
    expect(children[0].killed).to.deep.equal(['SIGTERM']);
  });

  it('reports nothing when no reading came for 4 s', async () => {
    const s = sampler();
    s.start();
    await clock.tickAsync(0);
    children[0].stdout.emit('data', line(60));
    await clock.tickAsync(SAMPLE_INTERVAL_MS * 4);
    await s.stop();

    expect(samples.length).to.be.lessThan(3);
  });

  it('asks for the tunnel again every 30 s', async () => {
    const s = sampler();
    s.start();
    await clock.tickAsync(0);
    await clock.tickAsync(TUNNEL_RENEW_MS * 2);
    await s.stop();

    expect(borrows).to.equal(3);
  });

  it('starts sysmontap again when it exits, and gives up after 5 exits with no reading', async () => {
    const s = sampler();
    s.start();
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i += 1) {
      await clock.tickAsync(0);
      children[children.length - 1].emit('exit', 1);
      await clock.tickAsync(30_000);
    }

    expect(children).to.have.length(MAX_CONSECUTIVE_FAILURES);
    expect(gaveUp).to.deep.equal(['ios sysmontap kept exiting']);
  });
});
