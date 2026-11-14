import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { useArtifactStore } from '../helpers/artifact-store';
import { RecordingOrchestrator } from '../../src/services/recording/RecordingOrchestrator';
import { ConcurrencyGate } from '../../src/services/recording/concurrency-gate';
import { selectOwnActiveGroups } from '../../src/services/recording/activeRecordings';
import {
  buildLibrary,
  summarizeGroup,
  type SummaryContext,
  type SummaryRow,
} from '../../src/services/recording/recordingSummary';
import { parseLibraryQuery } from '../../src/app/routers/recordingRequests';

/**
 * Two servers can report a phone of one udid (a hub's emulator-5554 and its
 * node's), so every recording answer names its phone by udid and host.
 */
const E = 'emulator-5554';
const H1 = 'http://h1:4723';
const H2 = 'http://h2:4723';
const ALICE = 'usr_alice';

describe('recording answers name the phone by udid and host', () => {
  describe('the orchestrator', () => {
    useArtifactStore();
    afterEach(() => sinon.restore());

    function orchestrator(rows: any[] = []) {
      const store = {
        rows,
        create: sinon.stub().callsFake(async (i: any) => {
          rows.push({
            id: i.id,
            group_id: i.groupId,
            device_udid: i.deviceUdid,
            device_host: i.deviceHost,
            file_path: i.filePath,
            started_at: new Date().toISOString(),
            status: 'RECORDING',
          });
          return i;
        }),
        finalize: sinon.stub().resolves(true),
        listActive: sinon.stub().resolves([]),
        listGroup: sinon.stub().callsFake(async () => rows),
      };
      return new RecordingOrchestrator({
        busyPrecheck: { findBusy: sinon.stub().resolves([]) } as any,
        store: store as any,
        gate: new ConcurrencyGate(4) as any,
        videoPipeline: {
          startRecording: sinon.stub().resolves(),
          stopRecording: sinon.stub().resolves('/tmp/x.mp4'),
          startComposite: sinon.stub().resolves({ cellW: 540, cellH: 960, cols: 2, rows: 1 }),
          stopComposite: sinon.stub().resolves(null),
        } as any,
        eventMgr: {
          emitRecordingStarted: sinon.stub(),
          emitRecordingStopped: sinon.stub(),
          emitRecordingFailed: sinon.stub(),
        } as any,
        blockDeviceFn: sinon.stub().resolves(),
        unblockDeviceFn: sinon.stub().resolves(),
        ensureMjpegPortFn: sinon.stub().resolves(9100),
        nodeSourceFn: sinon.stub().resolves(null),
        leaveDeviceFn: sinon.stub(),
        probeDurationMsFn: async () => 1000,
      });
    }

    it('the start of two same-named phones names each by its host, and so does the stop', async () => {
      const orch = orchestrator();
      const { groupId, recordings } = await orch.start({
        phones: [
          { udid: E, host: H1 },
          { udid: E, host: H2 },
        ],
        actorId: ALICE,
      });
      expect(recordings.map((r) => ({ udid: r.udid, host: r.host }))).to.deep.equal([
        { udid: E, host: H1 },
        { udid: E, host: H2 },
      ]);

      const stopped = await orch.stop(groupId);
      expect(stopped.recordings.map((r) => ({ id: r.id, host: r.host }))).to.deep.equal(
        recordings.map((r) => ({ id: r.id, host: r.host })),
      );
    });

    it('add-device names the phone it added by its host', async () => {
      // add-device takes a phone only into a group still recording.
      const orch = orchestrator([
        { id: 'r-run', group_id: 'grp', device_udid: E, device_host: H1, status: 'RECORDING' },
      ]);
      const { recording } = await orch.addDevice('grp', { udid: E, host: H2 }, ALICE);
      expect(recording).to.include({ udid: E, host: H2, status: 'RECORDING' });
    });
  });

  it('/recordings/active names each recording by its host', () => {
    const at = new Date('2026-11-13T10:00:00Z');
    const out = selectOwnActiveGroups(
      [
        { id: 'r1', group_id: 'g', device_udid: E, device_host: H1, started_at: at },
        { id: 'r2', group_id: 'g', device_udid: E, device_host: H2, started_at: at },
      ],
      (_udid, host) => (host === H1 ? `manual_${ALICE}_${E}` : null),
      { userId: ALICE },
    );
    expect(out[0].recordings).to.deep.equal([
      { id: 'r1', udid: E, host: H1 },
      { id: 'r2', udid: E, host: H2 },
    ]);
  });

  describe('the summaries and the library', () => {
    const T0 = Date.parse('2026-11-13T10:00:00Z');
    const row = (id: string, group: string, host: string, over: Partial<SummaryRow> = {}) =>
      ({
        id,
        group_id: group,
        device_udid: E,
        device_host: host,
        status: 'STOPPED',
        started_at: new Date(T0),
        ended_at: new Date(T0 + 10_000),
        duration_ms: 10_000,
        size_bytes: 1000,
        fail_reason: null,
        started_by: ALICE,
        bookmarkLabels: [],
        annotationCount: 0,
        ...over,
      }) as SummaryRow;
    const ctx: SummaryContext = {
      // Names by phone: `udid@host`.
      devices: new Map([
        [`${E}@${H1}`, { name: 'Hub emulator', platform: 'android' }],
        [`${E}@${H2}`, { name: 'Node emulator', platform: 'android' }],
      ]),
      users: new Map([[ALICE, 'Alice']]),
      retention: { days: 30, failedDays: 2, maxCount: 100 },
      hasComposite: () => false,
    };

    it("the group's phones carry their host and each phone's own name", () => {
      const s = summarizeGroup([row('r1', 'g', H1), row('r2', 'g', H2)], ctx);
      expect(s.phones.map((p) => ({ udid: p.udid, host: p.host, name: p.name }))).to.deep.equal([
        { udid: E, host: H1, name: 'Hub emulator' },
        { udid: E, host: H2, name: 'Node emulator' },
      ]);
    });

    it('a phone named only by its udid (one server had it) keeps that name', () => {
      const byUdid: SummaryContext = {
        ...ctx,
        devices: new Map([['U1', { name: 'Galaxy S9+', platform: 'android' }]]),
      };
      const s = summarizeGroup([row('r1', 'g', H1, { device_udid: 'U1' })], byUdid);
      expect(s.phones[0]).to.include({ udid: 'U1', host: H1, name: 'Galaxy S9+' });
    });

    const library = (filter: any) =>
      buildLibrary(
        [row('r1', 'g1', H1), row('r2', 'g2', H2), row('r3', 'g3', H1), row('r4', 'g3', H2)],
        ctx,
        filter,
        { limit: 50, now: T0 },
      );

    it('?udid=&host= lists only that host’s recordings of the udid', () => {
      const page = library({ udid: E, host: H2 });
      expect(page.recordings.map((s) => s.groupId).sort()).to.deep.equal(['g2', 'g3']);
      expect(library({ udid: E }).recordings).to.have.length(3);
    });

    it('the phone facets are per phone, named with the host when a udid repeats', () => {
      const page = library({});
      expect(page.facets.phones).to.deep.equal([
        { udid: E, host: H1, name: `Hub emulator (${H1})`, count: 2 },
        { udid: E, host: H2, name: `Node emulator (${H2})`, count: 2 },
      ]);
    });

    it('a udid two servers have now is split by host, though its recordings name one host', () => {
      const page = buildLibrary([row('r1', 'g1', H1)], ctx, {}, { limit: 50, now: T0 });
      expect(page.facets.phones).to.deep.equal([
        { udid: E, host: H1, name: `Hub emulator (${H1})`, count: 1 },
      ]);
    });

    it('a phone one server has is one facet with no host, though its server changed address', () => {
      const moved: SummaryContext = {
        ...ctx,
        // One Device row: keyed by its phone and by its bare udid.
        devices: new Map([
          [`${E}@${H2}`, { name: 'Pixel', platform: 'android' }],
          [E, { name: 'Pixel', platform: 'android' }],
        ]),
      };
      const page = buildLibrary(
        [row('r1', 'g1', H1), row('r2', 'g2', H2)],
        moved,
        {},
        { limit: 50, now: T0 },
      );
      expect(page.facets.phones).to.deep.equal([{ udid: E, name: 'Pixel', count: 2 }]);
    });

    it('the library query reads host, and refuses one that is not a non-empty string', () => {
      const ok = parseLibraryQuery({ udid: E, host: H2 });
      expect(ok.ok && ok.filter).to.deep.equal({ udid: E, host: H2 });
      expect(parseLibraryQuery({ udid: E, host: [H1, H2] })).to.deep.equal({
        ok: false,
        error: 'invalid_host',
      });
    });
  });
});
