import { expect } from 'chai';
import { H264NalParser } from '../../src/device-managers/android/h264NalParser';

// Parses an Annex-B H.264 byte stream (from `adb screenrecord --output-format=h264`)
// into access-unit packets. NAL type = first byte after the start code & 0x1f:
// 7=SPS, 8=PPS, 6=SEI, 9=AUD (non-VCL), 5=IDR slice (keyframe), 1=non-IDR slice.
// A NAL is emitted once the NEXT start code bounds it — so inputs terminate each
// access unit with the following frame's start code (a continuous stream always
// does). The final trailing NAL stays buffered until the next chunk arrives.
const SC = [0, 0, 0, 1]; // 4-byte start code
const nal = (type: number, ...body: number[]) => Buffer.from([...SC, type & 0x1f, ...body]);
const sps = nal(7, 0x42, 0x00, 0x1e);
const pps = nal(8, 0xaa);
const idr = nal(5, 0x11, 0x22);
const slice = nal(1, 0x33);
const slice2 = nal(1, 0x44);

describe('H264NalParser', () => {
  it('emits a config (SPS+PPS) then a keyframe for SPS+PPS+IDR', () => {
    const parser = new H264NalParser();
    // trailing `slice` terminates the IDR; it stays buffered
    const out = parser.push(Buffer.concat([sps, pps, idr, slice]));
    expect(out.map((p) => p.type)).to.deep.equal(['config', 'key']);
    expect(out[0].data.includes(0x42)).to.equal(true); // config carries SPS profile byte
    expect(out[1].data.includes(0x11)).to.equal(true); // key carries the IDR payload
    expect(out[1].data.includes(0xaa)).to.equal(true); // ...and the pending PPS
  });

  it('emits a delta for a following non-IDR slice', () => {
    const parser = new H264NalParser();
    parser.push(Buffer.concat([sps, pps, idr, slice])); // config, key; `slice` buffered
    const out = parser.push(slice2); // slice now bounded by slice2's start code
    expect(out.map((p) => p.type)).to.deep.equal(['delta']);
  });

  it('handles a start code split across two push() calls', () => {
    const parser = new H264NalParser();
    const whole = Buffer.concat([sps, pps, idr, slice]); // slice terminates the IDR
    const cut = sps.length + pps.length + 3; // split mid-way through the IDR
    const a = parser.push(whole.subarray(0, cut));
    const b = parser.push(whole.subarray(cut));
    expect([...a, ...b].map((p) => p.type)).to.deep.equal(['config', 'key']);
  });
});
