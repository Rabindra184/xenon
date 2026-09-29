import 'reflect-metadata';
import { expect } from 'chai';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { prisma } from '../../src/prisma';
import { useScratchDatabase } from '../helpers/scratch-database';

describe('RecordingStore (Prisma round-trip)', () => {
  // Its own migrated database: the round trip wrote these rows to the
  // developer's ~/.cache/xenon/xenon.db, and failed where it lacked the tables.
  const scratch = useScratchDatabase();
  const store = new RecordingStore();

  // Through the scratch client itself: the helper's own afterEach, which
  // runs first, has already put `prisma` back on the server's database.
  afterEach(async () => {
    await scratch.db.annotation.deleteMany({ where: { recording_id: { contains: 'test-' } } });
    await scratch.db.bookmark.deleteMany({ where: { recording_id: { contains: 'test-' } } });
    await scratch.db.recording.deleteMany({ where: { group_id: { startsWith: 'test-' } } });
  });

  it('creates a recording row with status=RECORDING', async () => {
    const rec = await store.create({
      id: 'test-rec-1',
      groupId: 'test-g1',
      deviceUdid: 'TEST-U1',
      deviceHost: '127.0.0.1',
      filePath: '/tmp/r.mp4',
      sessionId: null,
      deviceSnapshot: null,
    });
    expect(rec.status).to.equal('RECORDING');
    expect(rec.group_id).to.equal('test-g1');
    expect(rec.device_host).to.equal('127.0.0.1');
  });

  it('finalizes a recording with duration and size', async () => {
    const rec = await store.create({
      id: 'test-rec-2',
      groupId: 'test-g2',
      deviceUdid: 'TEST-U2',
      deviceHost: '127.0.0.1',
      filePath: '/tmp/r2.mp4',
      sessionId: null,
      deviceSnapshot: null,
    });
    const updated = await store.finalize(rec.id, {
      status: 'STOPPED',
      durationMs: 1234,
      sizeBytes: 5678,
    });
    expect(updated.status).to.equal('STOPPED');
    expect(updated.duration_ms).to.equal(1234);
    expect(updated.size_bytes).to.equal(5678);
    expect(updated.ended_at).to.be.instanceOf(Date);
  });

  // stream/stop asks this before tearing a stream down: stopping the stream
  // under a live recording lost the whole recording (FAILED, 28 bytes).
  it('activeRecordingFor finds the in-progress recording of a device, and its group', async () => {
    await store.create({
      id: 'test-rec-act',
      groupId: 'test-g-act',
      deviceUdid: 'TEST-UA',
      deviceHost: '127.0.0.1',
      filePath: '/tmp/ra.mp4',
      sessionId: null,
      deviceSnapshot: null,
    });
    expect(await store.activeRecordingFor('TEST-UA')).to.deep.equal({
      id: 'test-rec-act',
      groupId: 'test-g-act',
    });
    expect(await store.activeRecordingFor('TEST-OTHER')).to.equal(null);
    await store.finalize('test-rec-act', { status: 'STOPPED', durationMs: 1, sizeBytes: 1 });
    expect(await store.activeRecordingFor('TEST-UA')).to.equal(null);
  });

  it('listActive returns RECORDING rows globally', async () => {
    await store.create({
      id: 'test-rec-3',
      groupId: 'test-g3',
      deviceUdid: 'TEST-U3',
      deviceHost: '127.0.0.1',
      filePath: '/tmp/r3.mp4',
      sessionId: null,
      deviceSnapshot: null,
    });
    const active = await store.listActive();
    expect(active.some((r: any) => r.group_id === 'test-g3')).to.equal(true);
  });

  it('listGroup includes bookmarks and annotations', async () => {
    const rec = await store.create({
      id: 'test-rec-4',
      groupId: 'test-g4',
      deviceUdid: 'TEST-U4',
      deviceHost: '127.0.0.1',
      filePath: '/tmp/r4.mp4',
      sessionId: null,
      deviceSnapshot: null,
    });
    await store.addBookmark(rec.id, 'bug here', 1500, 'first repro');
    await store.addAnnotation(rec.id, {
      timecodeMs: 2000,
      shape: 'RECT',
      geometry: '{"x":0.1,"y":0.2,"w":0.3,"h":0.4}',
      color: '#ff0000',
    });
    const list = await store.listGroup('test-g4');
    expect(list).to.have.length(1);
    expect((list[0] as any).bookmarks).to.have.length(1);
    expect((list[0] as any).annotations).to.have.length(1);
  });

  it('clearAnnotations closes only open marks that started by the clear time', async () => {
    const rec = (id: string, groupId: string, udid: string) =>
      store.create({
        id,
        groupId,
        deviceUdid: udid,
        deviceHost: '127.0.0.1',
        filePath: `/tmp/${id}.mp4`,
        sessionId: null,
        deviceSnapshot: null,
      });
    await rec('test-rec-clr', 'test-gclr', 'TEST-UC');
    await rec('test-rec-oth', 'test-goth', 'TEST-UO');
    const base = { shape: 'RECT', geometry: '{}', color: 'red' };
    const before = await store.addAnnotation('test-rec-clr', { ...base, timecodeMs: 1000 });
    const after = await store.addAnnotation('test-rec-clr', { ...base, timecodeMs: 9000 });
    const other = await store.addAnnotation('test-rec-oth', { ...base, timecodeMs: 1000 });

    expect(await store.clearAnnotations(['test-rec-clr'], 5000)).to.equal(1);
    // A second clear must not move an already-closed mark.
    expect(await store.clearAnnotations(['test-rec-clr'], 7000)).to.equal(0);

    const rows = await prisma.annotation.findMany({
      where: { id: { in: [before.id, after.id, other.id] } },
    });
    const endOf = Object.fromEntries(rows.map((r: any) => [r.id, r.end_timecode_ms]));
    expect(endOf[before.id]).to.equal(5000);
    expect(endOf[after.id]).to.equal(null); // started after the clear
    expect(endOf[other.id]).to.equal(null); // another group
  });

  it('clearAnnotations with no recordings is a no-op', async () => {
    expect(await store.clearAnnotations([], 5000)).to.equal(0);
  });

  it('keeps who started a recording, and null when nobody is known', async () => {
    const a = await store.create({
      id: 'test-rec-by-1',
      groupId: 'test-g-by',
      deviceUdid: 'TEST-BY1',
      deviceHost: '127.0.0.1',
      filePath: '/tmp/by1.mp4',
      sessionId: null,
      deviceSnapshot: null,
      startedBy: 'usr_alice',
    });
    const b = await store.create({
      id: 'test-rec-by-2',
      groupId: 'test-g-by',
      deviceUdid: 'TEST-BY2',
      deviceHost: '127.0.0.1',
      filePath: '/tmp/by2.mp4',
      sessionId: null,
      deviceSnapshot: null,
    });
    expect(a.started_by).to.equal('usr_alice');
    expect(b.started_by).to.equal(null);
  });

  it('libraryRows carries bookmark labels and a mark count', async () => {
    await store.create({
      id: 'test-lib-1',
      groupId: 'test-g-lib',
      deviceUdid: 'TEST-L1',
      deviceHost: '127.0.0.1',
      filePath: '/tmp/l1.mp4',
      sessionId: null,
      deviceSnapshot: null,
      startedBy: 'usr_a',
    });
    await store.addBookmark('test-lib-1', 'Login', 1000);
    await store.addAnnotation('test-lib-1', {
      timecodeMs: 5,
      shape: 'RECT',
      geometry: '{}',
      color: 'red',
    });
    const rows = await store.libraryRows();
    const r = rows.find((x) => x.id === 'test-lib-1');
    if (!r) throw new Error('expected test-lib-1 in libraryRows()');
    expect(r.bookmarks.map((b) => b.label)).to.deep.equal(['Login']);
    expect(r._count.annotations).to.equal(1);
    expect(r.started_by).to.equal('usr_a');
  });

  it('deleteGroupRows removes the group’s rows, and their bookmarks and marks with them', async () => {
    for (const id of ['test-del-1', 'test-del-2']) {
      await store.create({
        id,
        groupId: 'test-g-del',
        deviceUdid: id.toUpperCase(),
        deviceHost: '127.0.0.1',
        filePath: `/tmp/${id}.mp4`,
        sessionId: null,
        deviceSnapshot: null,
      });
    }
    await store.addBookmark('test-del-1', 'x', 1);
    await store.addAnnotation('test-del-2', {
      timecodeMs: 1,
      shape: 'RECT',
      geometry: '{}',
      color: 'red',
    });
    expect(await store.deleteGroupRows('test-g-del')).to.equal(2);
    expect(await store.listGroup('test-g-del')).to.deep.equal([]);
    expect(await prisma.bookmark.count({ where: { recording_id: 'test-del-1' } })).to.equal(0);
    expect(await prisma.annotation.count({ where: { recording_id: 'test-del-2' } })).to.equal(0);
  });

  it('deleteGroupRows with ids removes only those rows of the group', async () => {
    for (const [id, groupId] of [
      ['test-part-1', 'test-g-part'],
      ['test-part-2', 'test-g-part'],
      ['test-part-3', 'test-g-part-other'],
    ]) {
      await store.create({
        id,
        groupId,
        deviceUdid: id.toUpperCase(),
        deviceHost: '127.0.0.1',
        filePath: `/tmp/${id}.mp4`,
        sessionId: null,
        deviceSnapshot: null,
      });
    }
    await store.addBookmark('test-part-1', 'x', 1);
    // An id from another group is not this group's to delete.
    expect(await store.deleteGroupRows('test-g-part', ['test-part-1', 'test-part-3'])).to.equal(1);
    expect((await store.listGroup('test-g-part')).map((r) => r.id)).to.deep.equal(['test-part-2']);
    expect((await store.listGroup('test-g-part-other')).map((r) => r.id)).to.deep.equal([
      'test-part-3',
    ]);
    expect(await prisma.bookmark.count({ where: { recording_id: 'test-part-1' } })).to.equal(0);
    expect(await store.deleteGroupRows('test-g-part', [])).to.equal(0);
    expect(await store.deleteGroupRows('test-g-part')).to.equal(1);
  });

  it('listGroupStarts reads who started each row of a group, and nothing more', async () => {
    for (const [id, startedBy] of [
      ['test-starts-1', 'usr_a'],
      ['test-starts-2', null],
    ]) {
      await store.create({
        id: id as string,
        groupId: 'test-g-starts',
        deviceUdid: (id as string).toUpperCase(),
        deviceHost: '127.0.0.1',
        filePath: `/tmp/${id}.mp4`,
        sessionId: null,
        deviceSnapshot: null,
        startedBy,
      });
    }
    await store.addBookmark('test-starts-1', 'x', 1);
    const rows = (await store.listGroupStarts('test-g-starts')).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    expect(rows.map((r) => Object.keys(r).sort())).to.deep.equal([
      ['device_udid', 'group_id', 'id', 'started_at', 'started_by'],
      ['device_udid', 'group_id', 'id', 'started_at', 'started_by'],
    ]);
    expect(rows.map((r) => [r.id, r.device_udid, r.started_by])).to.deep.equal([
      ['test-starts-1', 'TEST-STARTS-1', 'usr_a'],
      ['test-starts-2', 'TEST-STARTS-2', null],
    ]);
    expect(rows[0].started_at).to.be.instanceOf(Date);
    expect(await store.listGroupStarts('test-g-none')).to.deep.equal([]);
  });

  it('listActiveWithMarks reads the in-progress recordings with their marks', async () => {
    for (const id of ['test-live-1', 'test-live-2']) {
      await store.create({
        id,
        groupId: 'test-g-live',
        deviceUdid: id.toUpperCase(),
        deviceHost: '127.0.0.1',
        filePath: `/tmp/${id}.mp4`,
        sessionId: null,
        deviceSnapshot: null,
      });
    }
    await store.finalize('test-live-2', { status: 'STOPPED' });
    await store.addAnnotation('test-live-1', {
      timecodeMs: 1,
      shape: 'RECT',
      geometry: '{}',
      color: 'red',
    });
    const live = (await store.listActiveWithMarks()).filter((r) => r.group_id === 'test-g-live');
    expect(live.map((r) => r.id)).to.deep.equal(['test-live-1']);
    expect(live[0].annotations.map((a) => a.color)).to.deep.equal(['red']);
  });

  it('findVideo reads one recording without its bookmarks and marks', async () => {
    await store.create({
      id: 'test-video-1',
      groupId: 'test-g-video',
      deviceUdid: 'U-VIDEO',
      deviceHost: '127.0.0.1',
      filePath: '/tmp/test-video-1.mp4',
      sessionId: null,
      deviceSnapshot: null,
      startedBy: 'usr_a',
    });
    await store.addBookmark('test-video-1', 'x', 1);
    const rec = await store.findVideo('test-video-1');
    expect(Object.keys(rec ?? {}).sort()).to.deep.equal([
      'device_udid',
      'file_path',
      'group_id',
      'id',
      'started_at',
      'started_by',
      'status',
    ]);
    expect(rec).to.deep.include({
      id: 'test-video-1',
      group_id: 'test-g-video',
      device_udid: 'U-VIDEO',
      file_path: '/tmp/test-video-1.mp4',
      status: 'RECORDING',
      started_by: 'usr_a',
    });
    expect(await store.findVideo('test-video-none')).to.equal(null);
  });

  it('names users by name, then email', async () => {
    const names = await store.userNames([]);
    expect(names.size).to.equal(0);
  });
});
