import { expect } from 'chai';
import { encodeWsFrame, parseH264WsPath } from '../../src/app/ws/h264StreamWs';

// Wire format for the H.264 video WebSocket: [1 byte type][H.264 Annex-B
// payload]. type 0=config, 1=key, 2=delta.
describe('encodeWsFrame', () => {
  it('encodes config (0) with the payload at offset 1', () => {
    const f = encodeWsFrame({ type: 'config', data: Buffer.from([0x67, 0x42]), ptsMs: 0 });
    expect(f.readUInt8(0)).to.equal(0);
    expect(f.subarray(1)).to.deep.equal(Buffer.from([0x67, 0x42]));
  });
  it('encodes key (1) with the payload at offset 1', () => {
    const f = encodeWsFrame({ type: 'key', data: Buffer.from([9, 9]), ptsMs: 5 });
    expect(f.readUInt8(0)).to.equal(1);
    expect(f.subarray(1)).to.deep.equal(Buffer.from([9, 9]));
  });
  it('encodes delta (2)', () => {
    const f = encodeWsFrame({ type: 'delta', data: Buffer.from([1]), ptsMs: 33 });
    expect(f.readUInt8(0)).to.equal(2);
    expect(f.subarray(1)).to.deep.equal(Buffer.from([1]));
  });
});

describe('parseH264WsPath', () => {
  it('extracts udid + ticket from the h264 stream path', () => {
    const r = parseH264WsPath('/xenon/api/control/ABC123/stream/h264?ticket=tok.en');
    expect(r).to.deep.equal({ udid: 'ABC123', ticket: 'tok.en' });
  });
  it('url-decodes the udid', () => {
    const r = parseH264WsPath('/xenon/api/control/a%20b/stream/h264?ticket=t');
    expect(r?.udid).to.equal('a b');
  });
  it('returns null for a non-matching path', () => {
    expect(parseH264WsPath('/xenon/api/control/ABC/stream')).to.equal(null);
    expect(parseH264WsPath('/something/else')).to.equal(null);
  });
  it('returns null when the ticket is missing', () => {
    expect(parseH264WsPath('/xenon/api/control/ABC/stream/h264')).to.equal(null);
  });
});
