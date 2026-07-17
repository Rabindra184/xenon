import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import os from 'os';
import { Container } from 'typedi';
import { metrics, trace } from '@opentelemetry/api';
import { METRIC } from '../../src/services/telemetry/attributes';
import { ARTIFACT_STORE, FsArtifactStore } from '../../src/services/artifacts/ArtifactStore';

// Stub metrics + trace BEFORE the module loads so the module-level
// ensureOtelInstruments() picks up our mocks. Inline import after stubbing.
function makeMockMeter() {
  const counters = new Map<string, { add: sinon.SinonSpy }>();
  const histograms = new Map<string, { record: sinon.SinonSpy }>();
  const meter = {
    createCounter: (name: string) => {
      let c = counters.get(name);
      if (!c) {
        c = { add: sinon.spy() };
        counters.set(name, c);
      }
      return c;
    },
    createHistogram: (name: string) => {
      let h = histograms.get(name);
      if (!h) {
        h = { record: sinon.spy() };
        histograms.set(name, h);
      }
      return h;
    },
  } as any;
  return { meter, counters, histograms };
}

function makeMockSpan() {
  return {
    addEvent: sinon.spy(),
    setAttributes: sinon.spy(),
    setStatus: sinon.spy(),
    recordException: sinon.spy(),
    end: sinon.spy(),
  };
}

describe('RecordingOrchestrator instrumentation', () => {
  let getMeterStub: sinon.SinonStub;
  let getTracerStub: sinon.SinonStub;
  let mockSpan: ReturnType<typeof makeMockSpan>;
  let mockMeterCtx: ReturnType<typeof makeMockMeter>;
  // Hold module-level state in the SUT module so we can flip otelLoaded each
  // test without a full reload.
  let RecordingOrchestratorMod: any;

  before(() => {
    // Pre-stub once to get clean instrument creation in the SUT.
    getMeterStub = sinon.stub(metrics, 'getMeter');
    getTracerStub = sinon.stub(trace, 'getTracer');
    // RecordingOrchestrator resolves ARTIFACT_STORE from the container at
    // runtime (registered at boot in ServerManager); register it here so the
    // path-construction helpers work under test.
    Container.set(ARTIFACT_STORE, new FsArtifactStore(os.tmpdir()));
    // Now import — module-level let bindings will populate against the stub.
    RecordingOrchestratorMod = require('../../src/services/recording/RecordingOrchestrator');
  });

  after(() => {
    getMeterStub.restore();
    getTracerStub.restore();
    Container.remove(ARTIFACT_STORE);
  });

  beforeEach(() => {
    mockMeterCtx = makeMockMeter();
    mockSpan = makeMockSpan();
    getMeterStub.returns(mockMeterCtx.meter);
    getTracerStub.returns({ startSpan: () => mockSpan } as any);
    // Force re-init so each test has fresh counter spies.
    // The module-level `otelLoaded` flag and instrument bindings are private,
    // but ensureOtelInstruments() is idempotent — to reset, we re-require.
    delete require.cache[
      require.resolve('../../src/services/recording/RecordingOrchestrator')
    ];
    RecordingOrchestratorMod = require('../../src/services/recording/RecordingOrchestrator');
  });

  function makeOrchestrator(overrides: any = {}) {
    const fakeStore = {
      create: sinon.stub().resolves(),
      finalize: sinon.stub().resolves(),
      listGroup: sinon.stub().resolves([]),
      listActive: sinon.stub().resolves([]),
      addBookmark: sinon.stub().resolves({}),
      addAnnotation: sinon.stub().resolves({}),
      ...overrides.store,
    };
    const fakeBusyPrecheck = {
      findBusy: sinon.stub().resolves([]),
      ...overrides.busyPrecheck,
    };
    const fakeGate = {
      tryAcquire: sinon.stub().returns(true),
      release: sinon.stub(),
      getLimit: sinon.stub().returns(8),
      activeCount: sinon.stub().returns(0),
      ...overrides.gate,
    };
    const fakeVideoPipeline = {
      startRecording: sinon.stub().resolves(),
      stopRecording: sinon.stub().resolves(),
      startComposite: sinon.stub().resolves(),
      stopComposite: sinon.stub().resolves(),
      ...overrides.videoPipeline,
    };
    const fakeEventMgr = {
      emitRecordingStarted: sinon.spy(),
      emitRecordingStopped: sinon.spy(),
      emitRecordingFailed: sinon.spy(),
      emitRecordingBookmark: sinon.spy(),
      emitRecordingAnnotation: sinon.spy(),
    };
    return new RecordingOrchestratorMod.RecordingOrchestrator({
      store: fakeStore,
      busyPrecheck: fakeBusyPrecheck,
      gate: fakeGate,
      videoPipeline: fakeVideoPipeline,
      eventMgr: fakeEventMgr,
      blockDeviceFn: sinon.stub().resolves(),
      unblockDeviceFn: sinon.stub().resolves(),
    });
  }

  it('start() emits attempts counter and device_count histogram on every call', async () => {
    const orch = makeOrchestrator();
    await orch.start({ udids: ['udid-1'], actorId: 'actor-x' });

    const attempts = mockMeterCtx.counters.get(METRIC.RECORDING_ATTEMPTS)!;
    const deviceCount = mockMeterCtx.histograms.get(METRIC.RECORDING_DEVICE_COUNT)!;
    expect(attempts.add.calledOnce).to.equal(true);
    expect(deviceCount.record.calledOnce).to.equal(true);
    expect(deviceCount.record.firstCall.args[0]).to.equal(1);
  });

  it('start() emits failures counter with fail_reason=device_busy when precheck fails', async () => {
    const orch = makeOrchestrator({
      busyPrecheck: {
        findBusy: sinon.stub().resolves([{ udid: 'udid-1', reason: 'session-active' }]),
      },
    });
    try {
      await orch.start({ udids: ['udid-1'], actorId: 'actor-x' });
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal('device_busy');
    }
    const failures = mockMeterCtx.counters.get(METRIC.RECORDING_FAILURES)!;
    expect(failures.add.calledOnce).to.equal(true);
    expect(failures.add.firstCall.args[1]).to.deep.equal({ fail_reason: 'device_busy' });
    expect(mockSpan.setStatus.calledWith(sinon.match({ code: 2 }))).to.equal(true);
    expect(mockSpan.end.calledOnce).to.equal(true);
  });

  it('start() emits failures counter with fail_reason=concurrency_cap when gate refuses', async () => {
    const orch = makeOrchestrator({
      gate: { tryAcquire: sinon.stub().returns(false) },
    });
    try {
      await orch.start({ udids: ['udid-1'], actorId: 'actor-x' });
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal('concurrency_cap');
    }
    const failures = mockMeterCtx.counters.get(METRIC.RECORDING_FAILURES)!;
    expect(failures.add.firstCall.args[1]).to.deep.equal({ fail_reason: 'concurrency_cap' });
  });

  it('stop() emits duration histogram per finalized recording', async () => {
    const startedAt = new Date(Date.now() - 5000);
    const orch = makeOrchestrator({
      store: {
        listGroup: sinon.stub().resolves([
          {
            id: 'rec-1',
            device_udid: 'udid-1',
            device_host: '127.0.0.1',
            file_path: '/tmp/nonexistent.mp4',
            started_at: startedAt,
          },
        ]),
      },
    });
    await orch.stop('group-x');
    const duration = mockMeterCtx.histograms.get(METRIC.RECORDING_DURATION_MS)!;
    expect(duration.record.calledOnce).to.equal(true);
    const [val, labels] = duration.record.firstCall.args;
    expect(val).to.be.greaterThanOrEqual(4000);
    expect(labels).to.deep.equal({ outcome: 'success' });
  });

  it('stop() marks outcome=failure when ffmpeg stop throws', async () => {
    const orch = makeOrchestrator({
      videoPipeline: {
        stopRecording: sinon.stub().rejects(new Error('ffmpeg pipe broken')),
        stopComposite: sinon.stub().resolves(),
      },
      store: {
        listGroup: sinon.stub().resolves([
          {
            id: 'rec-1',
            device_udid: 'udid-1',
            device_host: '127.0.0.1',
            file_path: '/tmp/nonexistent.mp4',
            started_at: new Date(Date.now() - 1000),
          },
        ]),
      },
    });
    await orch.stop('group-x');
    const duration = mockMeterCtx.histograms.get(METRIC.RECORDING_DURATION_MS)!;
    const failures = mockMeterCtx.counters.get(METRIC.RECORDING_FAILURES)!;
    expect(duration.record.firstCall.args[1]).to.deep.equal({ outcome: 'failure' });
    expect(failures.add.calledOnce).to.equal(true);
    expect(failures.add.firstCall.args[1]).to.deep.equal({ fail_reason: 'ffmpeg pipe broken' });
  });

  it('recoverOnBoot() emits failures counter with server_restart per orphan', async () => {
    const orch = makeOrchestrator({
      store: {
        listActive: sinon.stub().resolves([
          { id: 'rec-1', device_udid: 'u1', device_host: '127.0.0.1' },
          { id: 'rec-2', device_udid: 'u2', device_host: '127.0.0.1' },
        ]),
      },
    });
    await orch.recoverOnBoot();
    const failures = mockMeterCtx.counters.get(METRIC.RECORDING_FAILURES)!;
    expect(failures.add.callCount).to.equal(2);
    expect(failures.add.firstCall.args[1]).to.deep.equal({ fail_reason: 'server_restart' });
  });

  it('addDevice() emits attempts + failures counters on busy', async () => {
    const orch = makeOrchestrator({
      busyPrecheck: {
        findBusy: sinon.stub().resolves([{ udid: 'udid-1', reason: 'session-active' }]),
      },
    });
    try {
      await orch.addDevice('group-x', 'udid-1', 'actor-x');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal('device_busy');
    }
    const attempts = mockMeterCtx.counters.get(METRIC.RECORDING_ATTEMPTS)!;
    const failures = mockMeterCtx.counters.get(METRIC.RECORDING_FAILURES)!;
    expect(attempts.add.calledOnce).to.equal(true);
    expect(failures.add.firstCall.args[1]).to.deep.equal({ fail_reason: 'device_busy' });
  });

  it('does not put UDIDs as a span attribute (cardinality discipline)', async () => {
    const orch = makeOrchestrator();
    const longUdidList = Array.from({ length: 8 }, (_, i) => `udid-cardinality-${i}`);
    await orch.start({ udids: longUdidList, actorId: 'actor-x' });

    for (const call of mockSpan.setAttributes.getCalls()) {
      const attrs = call.args[0];
      for (const v of Object.values(attrs)) {
        const s = JSON.stringify(v);
        for (const u of longUdidList) {
          expect(s).to.not.include(u);
        }
      }
    }
  });
});
