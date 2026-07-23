import { expect } from 'chai';
import { resolveStreamType } from '../../src/app/routers/streamType';

// The stream type the backend advertises to the frontend player selector.
// Android gets H.264 only when the flag is on and the device is not recording
// (recording keeps MJPEG — spec phase-1 rule). iOS is always MJPEG.
describe('resolveStreamType', () => {
  it('iOS is always mjpeg', () => {
    expect(resolveStreamType('ios', true, false)).to.equal('mjpeg');
    expect(resolveStreamType('tvos', true, false)).to.equal('mjpeg');
  });
  it('flag off => mjpeg', () => {
    expect(resolveStreamType('android', false, false)).to.equal('mjpeg');
  });
  it('recording => mjpeg', () => {
    expect(resolveStreamType('android', true, true)).to.equal('mjpeg');
  });
  it('android + flag on + not recording => h264', () => {
    expect(resolveStreamType('android', true, false)).to.equal('h264');
    expect(resolveStreamType('androidtv', true, false)).to.equal('h264');
  });
});
