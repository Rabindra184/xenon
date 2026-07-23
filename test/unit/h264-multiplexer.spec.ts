import { expect } from 'chai';
import { H264Multiplexer } from '../../src/device-managers/android/H264Multiplexer';

// One upstream H.264 stream fanned out to many WS clients. A new client must
// receive the latest SPS/PPS config, then start at the next keyframe (never
// mid-GOP) so its WebCodecs decoder can configure and decode cleanly.
const P = (type: any, n: number) => ({ type, data: Buffer.from([n]), ptsMs: n });

describe('H264Multiplexer', () => {
  it('new client gets config, then waits for the next keyframe (no mid-GOP delta)', () => {
    const m = new H264Multiplexer();
    m.setConfig(P('config', 0));
    const got: string[] = [];
    m.addClient((p) => got.push(p.type));
    m.push(P('delta', 1)); // before first key -> withheld
    m.push(P('key', 2));
    m.push(P('delta', 3));
    expect(got).to.deep.equal(['config', 'key', 'delta']);
  });

  it('a client that joins before any config still starts at the first keyframe', () => {
    const m = new H264Multiplexer();
    const got: string[] = [];
    m.addClient((p) => got.push(p.type));
    m.push(P('config', 0)); // config seen after join -> forwarded
    m.push(P('delta', 1)); // still no keyframe -> withheld
    m.push(P('key', 2));
    expect(got).to.deep.equal(['config', 'key']);
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
});
