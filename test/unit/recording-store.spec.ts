import 'reflect-metadata';
import { expect } from 'chai';
import { RecordingStore } from '../../src/services/recording/recording-store';
import { prisma } from '../../src/prisma';

describe('RecordingStore (Prisma round-trip)', () => {
  const store = new RecordingStore();

  afterEach(async () => {
    await prisma.annotation.deleteMany({ where: { recording_id: { contains: 'test-' } } });
    await prisma.bookmark.deleteMany({ where: { recording_id: { contains: 'test-' } } });
    await prisma.recording.deleteMany({ where: { group_id: { startsWith: 'test-' } } });
  });

  it('creates a recording row with status=RECORDING', async () => {
    const rec = await store.create({
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

  it('listActive returns RECORDING rows globally', async () => {
    await store.create({
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
});
