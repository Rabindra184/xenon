import 'reflect-metadata';
import { expect } from 'chai';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';

// Fast-start regression: startStream used to flip status to 'running' BEFORE the
// first-frame warmup. The capture loop skips capturing whenever
// (viewerCount === 0 && status === 'running'), and at startup no browser has
// attached yet — so the loop idled through the entire 5s first-frame budget,
// producing a ~5s dead startup. The fix keeps status 'starting' through warmup
// (so the loop captures eagerly) and flips to 'running' only after a frame is
// cached. This test pins the idle predicate that encodes that intent.

function makeService() {
  // Instantiate without the constructor (which starts a watchdog interval).
  return Object.create(AndroidStreamService.prototype) as any;
}

describe('AndroidStreamService fast-start idle predicate', () => {
  const svc = makeService();

  it('does NOT idle during warmup (status "starting") even with zero viewers', () => {
    // The whole point: warm the first frame before any viewer attaches.
    expect(svc.shouldIdleCapture({ status: 'starting', viewerCount: 0 })).to.equal(false);
  });

  it('idles when live ("running") and nobody is watching', () => {
    expect(svc.shouldIdleCapture({ status: 'running', viewerCount: 0 })).to.equal(true);
  });

  it('captures when live and at least one viewer is attached', () => {
    expect(svc.shouldIdleCapture({ status: 'running', viewerCount: 1 })).to.equal(false);
  });
});
