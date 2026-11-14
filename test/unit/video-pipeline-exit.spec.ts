import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { VideoPipelineService } from '../../src/services/VideoPipelineService';

// Issue #203. ffmpeg exiting on its own has to reach the caller, or the
// recording row it wrote stays at RECORDING forever.
//
// The delicate half is telling the two kinds of exit apart. Every stop also
// produces an exit event, so if a requested stop were reported as
// source-initiated, the orchestrator would finalize the same row twice on every
// ordinary Stop. The discriminator is the activeRecordings entry: stopRecording
// drops it *before* awaiting, so a surviving entry means nobody asked.
//
// #202 was this same class of bug — one path's side effect breaking another
// path's precondition, invisible to tests that exercise either alone — so both
// halves are pinned here.

function fakeProc(): any {
  const proc: any = new EventEmitter();
  proc.pid = 4242;
  const stdin: any = new EventEmitter();
  stdin.write = () => true;
  stdin.end = () => undefined;
  stdin.destroyed = false;
  stdin.writable = true;
  proc.stdin = stdin;
  proc.kill = () => true;
  return proc;
}

describe('VideoPipelineService: reporting an ffmpeg exit', () => {
  let svc: any;

  beforeEach(() => {
    svc = new VideoPipelineService();
  });
  afterEach(() => sinon.restore());

  it('reports an exit nobody asked for', () => {
    const onExit = sinon.stub();
    svc.activeRecordings.set('rec-1', fakeProc());

    svc.handleProcessExit('rec-1', 0, onExit);

    expect(onExit.calledOnce, 'a self-exit must reach the caller').to.be.true;
    expect(onExit.firstCall.args[0]).to.equal(0);
    expect(svc.activeRecordings.has('rec-1'), 'handle cleared either way').to.be.false;
  });

  it('passes a non-zero code through, so a crash is distinguishable', () => {
    const onExit = sinon.stub();
    svc.activeRecordings.set('rec-1', fakeProc());

    svc.handleProcessExit('rec-1', 1, onExit);

    expect(onExit.firstCall.args[0]).to.equal(1);
  });

  it('passes null for a signal death', () => {
    const onExit = sinon.stub();
    svc.activeRecordings.set('rec-1', fakeProc());

    svc.handleProcessExit('rec-1', null, onExit);

    expect(onExit.firstCall.args[0]).to.equal(null);
  });

  it('does NOT report an exit that stopRecording asked for', () => {
    // No entry means stopRecording already claimed this exit.
    const onExit = sinon.stub();

    svc.handleProcessExit('rec-1', 0, onExit);

    expect(onExit.called, 'a requested stop is not a source-initiated end').to.be.false;
  });

  it('stopRecording clears the handle before it awaits, so the exit is claimed', async () => {
    // This ordering IS the discriminator above. If the delete moved back after
    // the await, every Stop would also fire the source-ended path.
    const proc = fakeProc();
    svc.activeRecordings.set('rec-1', proc);
    svc.recordingPaths.delete('rec-1'); // no path → no remux, no real ffmpeg

    const stopping = svc.stopRecording('rec-1');
    expect(svc.activeRecordings.has('rec-1'), 'handle must be gone before stopRecording yields').to
      .be.false;

    proc.emit('exit', 0);
    await stopping;
  });

  it('survives a callback that throws', () => {
    svc.activeRecordings.set('rec-1', fakeProc());
    expect(() =>
      svc.handleProcessExit('rec-1', 0, () => {
        throw new Error('handler blew up');
      }),
    ).to.not.throw();
  });

  it('works without a callback at all (session-video callers pass none)', () => {
    svc.activeRecordings.set('rec-1', fakeProc());
    expect(() => svc.handleProcessExit('rec-1', 0, undefined)).to.not.throw();
    expect(svc.activeRecordings.has('rec-1')).to.be.false;
  });
});

// A group's composite ffmpeg can end on its own too (a phone's stream drops
// for good, ffmpeg crashes). Through 2.36 its exit only dropped the handle,
// so the orchestrator went on believing the composite recorded until stop.
// The same discriminator as above: stopComposite drops the handle before it
// awaits the exit it asked for.
describe('VideoPipelineService: reporting a composite ffmpeg exit', () => {
  let svc: any;

  beforeEach(() => {
    svc = new VideoPipelineService();
  });
  afterEach(() => sinon.restore());

  it('reports an exit nobody asked for, with its code', () => {
    const onExit = sinon.stub();
    svc.activeComposites.set('grp-1', fakeProc());

    svc.handleCompositeExit('grp-1', 1, onExit);

    expect(onExit.calledOnceWith(1)).to.equal(true);
    expect(svc.activeComposites.has('grp-1')).to.equal(false);
  });

  it('keeps the path, so the stop still finds the file', () => {
    svc.activeComposites.set('grp-1', fakeProc());
    svc.compositePaths.set('grp-1', '/nowhere/composite.mp4');

    svc.handleCompositeExit('grp-1', null, sinon.stub());

    expect(svc.getCompositePath('grp-1')).to.equal('/nowhere/composite.mp4');
  });

  it('does not report an exit stopComposite asked for', () => {
    const onExit = sinon.stub();

    svc.handleCompositeExit('grp-1', 0, onExit);

    expect(onExit.called).to.equal(false);
  });

  it('stopComposite drops the handle before it awaits, so its exit is claimed', async () => {
    const proc = fakeProc();
    const onExit = sinon.stub();
    proc.on('exit', (code: number) => svc.handleCompositeExit('grp-1', code, onExit));
    svc.activeComposites.set('grp-1', proc);

    const stopping = svc.stopComposite('grp-1');
    expect(svc.activeComposites.has('grp-1')).to.equal(false);
    proc.emit('exit', 0);
    await stopping;

    expect(onExit.called).to.equal(false);
  });

  it('survives a callback that throws', () => {
    svc.activeComposites.set('grp-1', fakeProc());
    expect(() =>
      svc.handleCompositeExit('grp-1', 1, () => {
        throw new Error('handler blew up');
      }),
    ).to.not.throw();
  });
});
