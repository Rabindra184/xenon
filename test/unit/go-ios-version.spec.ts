import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import {
  GO_IOS_PACKAGE_ENTRY,
  GO_IOS_PACKAGE_SPEC,
  GO_IOS_SHA256,
  GO_IOS_VERSION,
} from '../../src/scripts/goIosVersion';

// go-ios v1.0.134 does not keep the iOS 17+/26 XCTest session alive: WDA is
// terminated by the OS a few minutes after `runwda` starts, with the host side
// none the wiser. Measured on iOS 26.5.2 with an identical WDA 11.4.1 build —
// v1.0.134 died at 2m51s, v1.2.1 was still alive at 12min (see issue #187).

describe('the go-ios pin', () => {
  it('is pinned at or above v1.2.1 — the first version verified to keep WDA alive', () => {
    const [major, minor] = GO_IOS_VERSION.replace(/^v/, '').split('.').map(Number);
    expect(major * 1000 + minor, `pinned ${GO_IOS_VERSION}`).to.be.at.least(1 * 1000 + 2);
  });

  it('names the npm release of the pinned version', () => {
    expect(GO_IOS_PACKAGE_SPEC).to.equal(`go-ios@${GO_IOS_VERSION.replace(/^v/, '')}`);
  });

  it('takes the Mac binary from the tarball', () => {
    expect(GO_IOS_PACKAGE_ENTRY).to.match(
      /^package\/dist\/go-ios-darwin-[a-z0-9]+_darwin_[a-z0-9]+\/ios$/,
    );
  });

  it('pins the binary by a SHA-256', () => {
    expect(GO_IOS_SHA256).to.match(/^[0-9a-f]{64}$/);
  });

  it('keeps the line Xenon Control reads', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/scripts/goIosVersion.ts'),
      'utf8',
    );
    expect(src).to.match(/^export const GO_IOS_VERSION = '[^']+';$/m);
  });
});
