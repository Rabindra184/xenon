import { expect } from 'chai';
import sinon from 'sinon';
import { LeaveScheduler, LEAVE_GRACE_MS } from '../../src/app/routers/streamLeave';

/**
 * A page that stops watching a device "leaves" rather than stopping it. The
 * hold belongs to the user and the device, not to one tab: stopping outright
 * froze every other tab on the same device and gave the phone away while
 * they were still using it.
 */
describe('LeaveScheduler', () => {
  let clock: sinon.SinonFakeTimers;
  let viewers: number;
  let recording: boolean;
  let stop: sinon.SinonStub;
  let scheduler: LeaveScheduler;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    viewers = 0;
    recording = false;
    stop = sinon.stub().resolves();
    scheduler = new LeaveScheduler({
      viewers: async () => viewers,
      isRecording: async () => recording,
      stop,
    });
  });

  afterEach(() => clock.restore());

  it('stops the preview once the grace passes with nobody watching', async () => {
    scheduler.leave('U1');
    await clock.tickAsync(LEAVE_GRACE_MS - 1);
    expect(stop.called, 'not before the grace').to.equal(false);
    await clock.tickAsync(1);
    expect(stop.calledOnceWith('U1')).to.equal(true);
  });

  it('keeps it while another tab still watches', async () => {
    viewers = 1;
    scheduler.leave('U1');
    await clock.tickAsync(LEAVE_GRACE_MS);
    expect(stop.called).to.equal(false);
  });

  it('keeps it while a recording runs', async () => {
    recording = true;
    scheduler.leave('U1');
    await clock.tickAsync(LEAVE_GRACE_MS);
    expect(stop.called).to.equal(false);
  });

  // A reload leaves, then the new page asks to start about a second later,
  // possibly before its stream connects. Without this the check would find
  // nobody watching and stop the new page's stream.
  it('keeps it when someone starts watching again within the grace', async () => {
    scheduler.leave('U1');
    await clock.tickAsync(1000);
    scheduler.cancel('U1');
    await clock.tickAsync(LEAVE_GRACE_MS);
    expect(stop.called).to.equal(false);
  });

  it('checks once for leaves in quick succession', async () => {
    scheduler.leave('U1');
    await clock.tickAsync(1000);
    scheduler.leave('U1');
    await clock.tickAsync(LEAVE_GRACE_MS);
    expect(stop.callCount).to.equal(1);
  });

  it('treats devices separately', async () => {
    viewers = 0;
    scheduler.leave('U1');
    scheduler.leave('U2');
    scheduler.cancel('U2');
    await clock.tickAsync(LEAVE_GRACE_MS);
    expect(stop.calledOnceWith('U1')).to.equal(true);
  });

  // The grace has run out and the check is under way (it awaits the viewer
  // count and the recording lookup) when the reloaded page's stream/start
  // lands. Through 2.36 cancel only cleared the timer, which had already
  // fired, so the old page's check stopped the new page's stream and
  // released its hold.
  describe('a start that lands while the check runs', () => {
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => (resolve = r));
      return { promise, resolve };
    }

    it('keeps the preview when it lands while the viewers are counted', async () => {
      const counted = deferred<number>();
      const slow = new LeaveScheduler({
        viewers: () => counted.promise,
        isRecording: async () => false,
        stop,
      });
      slow.leave('U1');
      await clock.tickAsync(LEAVE_GRACE_MS);

      slow.cancel('U1');
      counted.resolve(0);
      await clock.tickAsync(0);

      expect(stop.called).to.equal(false);
    });

    it('keeps the preview when it lands while the recording is looked up', async () => {
      const looked = deferred<boolean>();
      const slow = new LeaveScheduler({
        viewers: async () => 0,
        isRecording: () => looked.promise,
        stop,
      });
      slow.leave('U1');
      await clock.tickAsync(LEAVE_GRACE_MS);

      slow.cancel('U1');
      looked.resolve(false);
      await clock.tickAsync(0);

      expect(stop.called).to.equal(false);
    });

    it("leaves another device's check alone", async () => {
      const counted = deferred<number>();
      const slow = new LeaveScheduler({
        viewers: () => counted.promise,
        isRecording: async () => false,
        stop,
      });
      slow.leave('U1');
      await clock.tickAsync(LEAVE_GRACE_MS);

      slow.cancel('U2');
      counted.resolve(0);
      await clock.tickAsync(0);

      expect(stop.calledOnceWith('U1')).to.equal(true);
    });

    it('a later leave still stops the preview after its own grace', async () => {
      const slow = new LeaveScheduler({
        viewers: async () => 0,
        isRecording: async () => false,
        stop,
      });
      slow.leave('U1');
      await clock.tickAsync(LEAVE_GRACE_MS);
      slow.cancel('U1');
      stop.resetHistory();

      slow.leave('U1');
      await clock.tickAsync(LEAVE_GRACE_MS);

      expect(stop.calledOnceWith('U1')).to.equal(true);
    });
  });

  it('survives a failing check without an unhandled rejection', async () => {
    const failing = new LeaveScheduler({
      viewers: async () => {
        throw new Error('store down');
      },
      isRecording: async () => false,
      stop,
    });
    failing.leave('U1');
    await clock.tickAsync(LEAVE_GRACE_MS);
    expect(stop.called).to.equal(false);
  });
});
