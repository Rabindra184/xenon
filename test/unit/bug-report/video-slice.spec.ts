import { expect } from 'chai';
import { EventEmitter } from 'events';
import { sliceVideo } from '../../../src/services/bug-report/video-slice';

class FakeProc extends EventEmitter {
  stderr = new EventEmitter();
}

function fakeSpawn(proc: FakeProc) {
  return () => proc as any;
}

describe('sliceVideo', () => {
  it('returns ok=true when ffmpeg exits 0', async () => {
    const proc = new FakeProc();
    const p = sliceVideo('/in.mp4', 0, 60, '/tmp/out.mp4', fakeSpawn(proc));
    setImmediate(() => proc.emit('exit', 0));
    const result = await p;
    expect(result.ok).to.equal(true);
  });

  it('returns ok=false with reason on non-zero exit', async () => {
    const proc = new FakeProc();
    const p = sliceVideo('/in.mp4', 0, 60, '/tmp/out.mp4', fakeSpawn(proc));
    setImmediate(() => {
      proc.stderr.emit('data', Buffer.from('codec error'));
      proc.emit('exit', 1);
    });
    const result = await p;
    expect(result.ok).to.equal(false);
    if (!result.ok) expect(result.error).to.include('exit 1');
  });

  it('returns ok=false on spawn error', async () => {
    const proc = new FakeProc();
    const p = sliceVideo('/in.mp4', 0, 60, '/tmp/out.mp4', fakeSpawn(proc));
    setImmediate(() => proc.emit('error', new Error('ENOENT')));
    const result = await p;
    expect(result.ok).to.equal(false);
  });
});
