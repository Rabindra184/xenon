import 'reflect-metadata';
import { expect } from 'chai';
import { NodeMetricsStore } from '../../src/services/metrics/NodeMetricsStore';
import { KEEP_AFTER_END_MS } from '../../src/services/metrics/nodeMetrics';
import { MAX_BUFFERED_SAMPLES, MetricSample } from '../../src/services/metrics/types';

const sample = (at: number): MetricSample => ({
  at,
  deviceCpuPct: 10,
  deviceMemMb: 100,
  deviceMemTotalMb: 4000,
  appCpuPct: null,
  appMemMb: null,
  appId: null,
});

describe('NodeMetricsStore: a node holds its figures for the hub', () => {
  let now: number;
  let store: NodeMetricsStore;

  beforeEach(() => {
    now = 1_000_000;
    store = new NodeMetricsStore();
    store.now = () => now;
  });

  it('answers every sample without `after`, and only newer ones with it', () => {
    store.begin('s1', 'Android');
    [1, 2, 3].forEach((t) => store.add('s1', sample(t)));

    expect(store.read('s1', null)).to.deep.equal({
      platform: 'android',
      state: 'sampling',
      samples: [sample(1), sample(2), sample(3)],
    });
    expect(store.read('s1', 2).samples.map((s) => s.at)).to.deep.equal([3]);
  });

  it('drops what the hub has collected', () => {
    store.begin('s1', 'android');
    [1, 2, 3].forEach((t) => store.add('s1', sample(t)));
    store.read('s1', 2);
    expect(store.read('s1', null).samples.map((s) => s.at)).to.deep.equal([3]);
  });

  it('keeps the newest 900 samples', () => {
    store.begin('s1', 'android');
    for (let t = 1; t <= MAX_BUFFERED_SAMPLES + 5; t++) store.add('s1', sample(t));
    const ats = store.read('s1', null).samples.map((s) => s.at);
    expect(ats).to.have.length(MAX_BUFFERED_SAMPLES);
    expect(ats[0]).to.equal(6);
  });

  it('says a sampler that gave up stopped, and an ended session ended', () => {
    store.begin('s1', 'android');
    store.gaveUp('s1');
    expect(store.read('s1', null).state).to.equal('stopped');
    store.end('s1');
    expect(store.read('s1', null).state).to.equal('ended');
  });

  it('keeps an ended session 10 minutes for the last collection, then forgets it', () => {
    store.begin('s1', 'android');
    store.add('s1', sample(1));
    store.end('s1');
    now += KEEP_AFTER_END_MS - 1;
    expect(store.read('s1', null).samples).to.have.length(1);
    now += 1;
    expect(store.read('s1', null)).to.deep.equal({ platform: '', state: 'off', samples: [] });
  });

  it('says off for a session it has nothing for', () => {
    expect(store.read('nope', null)).to.deep.equal({ platform: '', state: 'off', samples: [] });
    store.add('nope', sample(1));
    expect(store.read('nope', null).samples).to.deep.equal([]);
  });
});
