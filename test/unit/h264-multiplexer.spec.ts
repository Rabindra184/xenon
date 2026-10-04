import { expect } from 'chai';
import { H264Multiplexer } from '../../src/device-managers/android/H264Multiplexer';

// One upstream H.264 stream fanned out to many WS clients. A new client gets the
// latest SPS/PPS config, then the current GOP (keyframe + deltas since) so its
// WebCodecs decoder starts immediately — screenrecord's keyframes are too
// infrequent to wait for. A client that joins before any keyframe waits.
const P = (type: any, n: number) => ({ type, data: Buffer.from([n]), ptsMs: n });

describe('H264Multiplexer', () => {
  it('replays config + current GOP (keyframe + deltas since) to a new client', () => {
    const m = new H264Multiplexer();
    m.setConfig(P('config', 0));
    m.push(P('key', 1));
    m.push(P('delta', 2));
    m.push(P('delta', 3));
    const got: Array<[string, number]> = [];
    m.addClient((p) => got.push([p.type, p.ptsMs]));
    // joins mid-GOP -> gets config, the keyframe, and both prior deltas at once
    expect(got).to.deep.equal([
      ['config', 0],
      ['key', 1],
      ['delta', 2],
      ['delta', 3],
    ]);
    // ...and continues live
    m.push(P('delta', 4));
    expect(got[got.length - 1]).to.deep.equal(['delta', 4]);
  });

  it('a client that joins before any keyframe gets config then waits for the first key', () => {
    const m = new H264Multiplexer();
    const got: string[] = [];
    m.addClient((p) => got.push(p.type));
    m.push(P('config', 0)); // forwarded to all
    m.push(P('delta', 1)); // withheld — no keyframe yet
    m.push(P('key', 2));
    m.push(P('delta', 3));
    expect(got).to.deep.equal(['config', 'key', 'delta']);
  });

  it('a new keyframe starts a fresh GOP for replay', () => {
    const m = new H264Multiplexer();
    m.push(P('key', 1));
    m.push(P('delta', 2));
    m.push(P('key', 3)); // new GOP resets the buffer
    m.push(P('delta', 4));
    const got: number[] = [];
    m.addClient((p) => got.push(p.ptsMs));
    expect(got).to.deep.equal([3, 4]); // only the latest GOP, not the old key/delta
  });

  it('removeClient stops delivery and drops clientCount', () => {
    const m = new H264Multiplexer();
    m.setConfig(P('config', 0));
    const got: string[] = [];
    const remove = m.addClient((p) => got.push(p.type));
    expect(m.clientCount).to.equal(1);
    remove();
    m.push(P('key', 1));
    expect(m.clientCount).to.equal(0);
    expect(got).to.deep.equal(['config']);
  });

  // The H.264 service ends a capture the moment its last viewer leaves when a
  // page has asked for MJPEG (AndroidH264StreamService.endWhenUnwatched).
  it('tells its listener when the last client leaves, once', () => {
    const m = new H264Multiplexer();
    let emptied = 0;
    m.onEmpty(() => (emptied += 1));
    const removeA = m.addClient(() => undefined);
    const removeB = m.addClient(() => undefined);

    removeA();
    expect(emptied, 'one viewer is still watching').to.equal(0);
    removeB();
    expect(emptied).to.equal(1);
    // A socket's close and error both remove the same client.
    removeB();
    expect(emptied).to.equal(1);
  });
});
