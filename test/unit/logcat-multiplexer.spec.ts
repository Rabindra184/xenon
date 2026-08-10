import { expect } from 'chai';
import sinon from 'sinon';
import {
  LogcatMultiplexer,
  REPLAY_BUFFER_SIZE,
} from '../../src/device-managers/android/LogcatMultiplexer';
import type { LogcatRecord } from '../../src/services/logcat/logcatParse';

const rec = (message: string, ts = 1): LogcatRecord => ({
  ts,
  pid: 1,
  tid: 1,
  level: 'D',
  tag: 'T',
  message,
});

describe('LogcatMultiplexer', () => {
  it('fans a record out to every client', () => {
    const mux = new LogcatMultiplexer();
    const a: LogcatRecord[] = [];
    const b: LogcatRecord[] = [];
    mux.addClient(
      (r) => a.push(r),
      () => true,
    );
    mux.addClient(
      (r) => b.push(r),
      () => true,
    );

    mux.push(rec('hello'));

    expect(a.map((r) => r.message)).to.deep.equal(['hello']);
    expect(b.map((r) => r.message)).to.deep.equal(['hello']);
  });

  it('reports clientCount and stops sending after the remover runs', () => {
    const mux = new LogcatMultiplexer();
    const seen: LogcatRecord[] = [];
    const remove = mux.addClient(
      (r) => seen.push(r),
      () => true,
    );
    expect(mux.clientCount).to.equal(1);

    remove();
    expect(mux.clientCount).to.equal(0);
    mux.push(rec('after removal'));
    expect(seen).to.have.length(0);
  });

  // Opening the tab should show recent history, not an empty pane.
  it('replays the buffered history to a late joiner', () => {
    const mux = new LogcatMultiplexer();
    mux.push(rec('one'));
    mux.push(rec('two'));

    const late: LogcatRecord[] = [];
    mux.addClient(
      (r) => late.push(r),
      () => true,
    );

    expect(late.map((r) => r.message)).to.deep.equal(['one', 'two']);
  });

  it('bounds the replay buffer', () => {
    const mux = new LogcatMultiplexer();
    for (let i = 0; i < 2500; i++) mux.push(rec(`m${i}`));

    const late: LogcatRecord[] = [];
    mux.addClient(
      (r) => late.push(r),
      () => true,
    );

    expect(late).to.have.length(2000);
    // Pin the exported constant itself, not just the literal it happens to
    // equal right now — Tasks 4 and 5 are told to consume REPLAY_BUFFER_SIZE.
    expect(late).to.have.length(REPLAY_BUFFER_SIZE);
    expect(late[0].message).to.equal('m500');
    expect(late[late.length - 1].message).to.equal('m2499');
  });

  // A dropped video frame is invisible; a dropped log line is data loss the
  // reader cannot detect. The gap must appear IN the log.
  it('emits a synthetic warning instead of dropping silently', () => {
    const mux = new LogcatMultiplexer();
    const seen: LogcatRecord[] = [];
    let accepting = true;
    mux.addClient(
      (r) => seen.push(r),
      () => accepting,
    );

    accepting = false;
    mux.push(rec('lost one'));
    mux.push(rec('lost two'));
    accepting = true;
    mux.push(rec('delivered'));

    const messages = seen.map((r) => r.message);
    expect(messages).to.not.include('lost one');
    expect(messages).to.include('delivered');
    const warning = seen.find((r) => r.synthetic);
    expect(warning, 'a synthetic drop record must be emitted').to.not.equal(undefined);
    expect(warning!.level).to.equal('W');
    expect(warning!.tag).to.equal('xenon');
    expect(warning!.message).to.contain('2');
    expect(warning!.message.toLowerCase()).to.contain('dropped');
  });

  it('coalesces consecutive drops into one record', () => {
    const mux = new LogcatMultiplexer();
    const seen: LogcatRecord[] = [];
    let accepting = true;
    mux.addClient(
      (r) => seen.push(r),
      () => accepting,
    );

    accepting = false;
    for (let i = 0; i < 10; i++) mux.push(rec(`lost ${i}`));
    accepting = true;
    mux.push(rec('delivered'));

    expect(seen.filter((r) => r.synthetic)).to.have.length(1);
    expect(seen.find((r) => r.synthetic)!.message).to.contain('10');
  });

  it('does not put synthetic drop records in the replay buffer', () => {
    const mux = new LogcatMultiplexer();
    let accepting = true;
    const remove = mux.addClient(
      () => undefined,
      () => accepting,
    );
    accepting = false;
    mux.push(rec('lost'));
    accepting = true;
    mux.push(rec('delivered'));
    remove();

    const late: LogcatRecord[] = [];
    mux.addClient(
      (r) => late.push(r),
      () => true,
    );
    // The drop was that one slow client's problem, not history.
    expect(late.filter((r) => r.synthetic)).to.have.length(0);
  });

  // The only behavior LogcatMultiplexer adds on top of H264Multiplexer is a
  // per-CLIENT drop counter. Every test above drives a single client (or two
  // clients that both always accept), so none of them can tell a per-client
  // counter apart from one shared across the whole mux. This drives two
  // clients with different canAccept() outcomes so a shared counter would
  // mis-attribute drops.
  it('isolates the drop counter per client', () => {
    const mux = new LogcatMultiplexer();
    const fast: LogcatRecord[] = [];
    const slow: LogcatRecord[] = [];
    let slowAccepting = false;
    mux.addClient(
      (r) => fast.push(r),
      () => true,
    );
    mux.addClient(
      (r) => slow.push(r),
      () => slowAccepting,
    );

    mux.push(rec('a'));
    mux.push(rec('b'));
    slowAccepting = true;
    mux.push(rec('c'));

    expect(fast.map((r) => r.message)).to.deep.equal(['a', 'b', 'c']);
    expect(fast.filter((r) => r.synthetic)).to.have.length(0);

    expect(slow.map((r) => r.message)).to.deep.equal(['2 lines dropped (slow client)', 'c']);
  });

  // Comment in push() asserts the synthetic precedes the record that closes
  // the gap; nothing pinned the order until now — moving the send() after
  // the synthetic emission still passed all other tests.
  it('emits the synthetic drop record before the record that closes the gap', () => {
    const mux = new LogcatMultiplexer();
    const seen: LogcatRecord[] = [];
    let accepting = true;
    mux.addClient(
      (r) => seen.push(r),
      () => accepting,
    );

    accepting = false;
    mux.push(rec('lost one'));
    mux.push(rec('lost two'));
    accepting = true;
    mux.push(rec('delivered'));

    expect(seen.map((r) => r.message)).to.deep.equal([
      '2 lines dropped (slow client)',
      'delivered',
    ]);
  });

  // parseThreadtimeLine derives ts from the device's clock; Date.now() is the
  // server's. Under clock skew a server-clock synthetic won't sort between
  // its real neighbours once Task 7 renders a timestamp column.
  it("stamps the synthetic drop record with the closing record's ts, not server clock", () => {
    const mux = new LogcatMultiplexer();
    const seen: LogcatRecord[] = [];
    let accepting = true;
    mux.addClient(
      (r) => seen.push(r),
      () => accepting,
    );

    accepting = false;
    mux.push(rec('lost'));
    accepting = true;
    mux.push(rec('delivered', 424242));

    const warning = seen.find((r) => r.synthetic);
    expect(warning, 'a synthetic drop record must be emitted').to.not.equal(undefined);
    expect(warning!.ts).to.equal(424242);
  });

  // c.send(...) in the fan-out loop was unguarded: a throwing sink propagated
  // out of push() and aborted the loop, so every client registered after the
  // bad one in the Set got nothing — with no drop accounting for them either.
  it("keeps fanning out to healthy clients when another client's sink throws", () => {
    const mux = new LogcatMultiplexer();
    const healthy: LogcatRecord[] = [];
    // Registered first so it's iterated before the healthy client — this is
    // the ordering that lets an unguarded throw starve everything after it.
    mux.addClient(
      () => {
        throw new Error('sink boom');
      },
      () => true,
    );
    mux.addClient(
      (r) => healthy.push(r),
      () => true,
    );

    mux.push(rec('one'));
    mux.push(rec('two'));

    expect(healthy.map((r) => r.message)).to.deep.equal(['one', 'two']);
  });

  // The test above never checks what the throwing sink itself is owed. A
  // thrown send loses the record exactly as surely as a refused one
  // (canAccept() === false), so it must be counted the same way. Pure
  // refusals or pure throws each pass under either of the two mutants this
  // guards against (dropped not incremented on throw; dropped cleared before
  // the send that's supposed to prove it succeeded) — only a run that mixes
  // failure modes and then recovers forces the count to be carried correctly
  // across attempts, which is what both cases below drive.
  it('coalesces a run of throwing sends into the full drop count once it recovers', () => {
    const mux = new LogcatMultiplexer();
    const seen: LogcatRecord[] = [];
    let sending: 'throw' | 'ok' = 'throw';
    mux.addClient(
      (r) => {
        if (sending === 'throw') throw new Error('sink boom');
        seen.push(r);
      },
      () => true,
    );

    mux.push(rec('lost one'));
    mux.push(rec('lost two'));
    mux.push(rec('lost three'));
    sending = 'ok';
    mux.push(rec('recovered'));

    expect(seen.map((r) => r.message)).to.deep.equal([
      '3 lines dropped (slow client)',
      'recovered',
    ]);
  });

  it('coalesces refusals and a throw together into one full drop count', () => {
    const mux = new LogcatMultiplexer();
    const seen: LogcatRecord[] = [];
    let accepting = true;
    let sending: 'throw' | 'ok' = 'ok';
    mux.addClient(
      (r) => {
        if (sending === 'throw') throw new Error('sink boom');
        seen.push(r);
      },
      () => accepting,
    );

    accepting = false;
    mux.push(rec('lost one')); // refused: canAccept() === false
    mux.push(rec('lost two')); // refused: canAccept() === false
    accepting = true;
    sending = 'throw';
    mux.push(rec('lost three')); // accepted, but the sink throws on send
    sending = 'ok';
    mux.push(rec('closing'));

    expect(seen.map((r) => r.message)).to.deep.equal(['3 lines dropped (slow client)', 'closing']);
  });

  // addClient added the client to the Set before replaying history to it. A
  // throw mid-replay left the client in the Set with no remover ever handed
  // back to the caller, so clientCount stayed permanently elevated — pinning
  // an idle watchdog open for the life of the process (see the identical,
  // already-fixed hazard documented in src/app/ws/h264StreamWs.ts:58-61).
  it('does not strand a phantom client when replay throws', () => {
    const mux = new LogcatMultiplexer();
    mux.push(rec('one'));

    expect(() =>
      mux.addClient(
        () => {
          throw new Error('replay boom');
        },
        () => true,
      ),
    ).to.throw();

    expect(mux.clientCount).to.equal(0);
  });

  // Spec error table: on `adb logcat` exiting, the service must "close
  // clients, drop the multiplexer". Dropping alone leaves the sockets attached
  // to an orphaned mux showing a frozen log, and those tabs never recover.
  describe('close()', () => {
    it('notifies every client and detaches them all', () => {
      const mux = new LogcatMultiplexer();
      const closed: string[] = [];
      const a: LogcatRecord[] = [];
      mux.addClient(
        (r) => a.push(r),
        () => true,
        () => closed.push('a'),
      );
      mux.addClient(
        () => undefined,
        () => true,
        () => closed.push('b'),
      );

      mux.close();

      expect(closed).to.deep.equal(['a', 'b']);
      expect(mux.clientCount).to.equal(0);
      mux.push(rec('after close'));
      expect(a.map((r) => r.message)).to.deep.equal([]);
    });

    // Same hazard as the fan-out loop: one bad sink must not strand the
    // clients that come after it in the Set.
    it('keeps closing the remaining clients when one onClose throws', () => {
      const mux = new LogcatMultiplexer();
      let healthyClosed = false;
      mux.addClient(
        () => undefined,
        () => true,
        () => {
          throw new Error('close boom');
        },
      );
      mux.addClient(
        () => undefined,
        () => true,
        () => (healthyClosed = true),
      );

      expect(() => mux.close()).to.not.throw();
      expect(healthyClosed).to.equal(true);
      expect(mux.clientCount).to.equal(0);
    });

    it('tolerates a client that registered no onClose', () => {
      const mux = new LogcatMultiplexer();
      mux.addClient(
        () => undefined,
        () => true,
      );
      expect(() => mux.close()).to.not.throw();
      expect(mux.clientCount).to.equal(0);
    });
  });

  // The idle watchdog reads emptySince instead of polling clientCount, so the
  // idle window is measured from the departure itself rather than from
  // whenever a poller next happened to look.
  describe('emptySince', () => {
    it('is stamped at construction, cleared on join, and restamped on the last leave', () => {
      const before = Date.now();
      const mux = new LogcatMultiplexer();
      // A stream whose only viewer dies mid-handshake never had a client; it
      // still has to be reclaimable.
      expect(mux.emptySince, 'a mux with no client yet is already empty').to.be.at.least(before);

      const a = mux.addClient(
        () => undefined,
        () => true,
      );
      const b = mux.addClient(
        () => undefined,
        () => true,
      );
      expect(mux.emptySince).to.equal(undefined);

      a();
      expect(mux.emptySince, 'one client left, one still attached').to.equal(undefined);
      b();
      expect(mux.emptySince).to.be.a('number');
    });

    // A socket that emits both 'close' and 'error' runs its remover twice.
    // Restamping on the second call pushes the idle deadline out by the gap
    // between them, every time.
    it('is not restamped by a remover called twice', () => {
      const clock = sinon.useFakeTimers();
      try {
        const mux = new LogcatMultiplexer();
        const remove = mux.addClient(
          () => undefined,
          () => true,
        );
        clock.tick(1_000);
        remove();
        expect(mux.emptySince).to.equal(1_000);
        clock.tick(5_000);
        remove(); // same socket, second teardown signal
        expect(mux.emptySince).to.equal(1_000);
      } finally {
        clock.restore();
      }
    });

    it('is stamped by close()', () => {
      const mux = new LogcatMultiplexer();
      mux.addClient(
        () => undefined,
        () => true,
      );
      expect(mux.emptySince).to.equal(undefined);
      mux.close();
      expect(mux.emptySince).to.be.a('number');
    });
  });
});
