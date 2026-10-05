import { expect } from 'chai';
import { EventEmitter } from 'events';
import path from 'path';
import { resolveFfmpegPath } from '../../../src/helpers/ffmpegPath';
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

  it("runs Xenon's own ffmpeg, never a bare `ffmpeg` from PATH", async () => {
    // A server started from the Mac app has no shell PATH, and src/index.ts puts
    // Xenon's ffmpeg folder at the end of PATH, behind any system ffmpeg.
    const proc = new FakeProc();
    let command = '';
    const p = sliceVideo('/in.mp4', 0, 60, '/tmp/out.mp4', (cmd: string) => {
      command = cmd;
      return proc as any;
    });
    setImmediate(() => proc.emit('exit', 0));
    await p;
    expect(command).to.equal(resolveFfmpegPath());
    expect(path.isAbsolute(command)).to.equal(true);
  });

  it('returns ok=false on spawn error', async () => {
    const proc = new FakeProc();
    const p = sliceVideo('/in.mp4', 0, 60, '/tmp/out.mp4', fakeSpawn(proc));
    setImmediate(() => proc.emit('error', new Error('ENOENT')));
    const result = await p;
    expect(result.ok).to.equal(false);
  });
});
