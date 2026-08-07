import { expect } from 'chai';
import {
  GO_IOS_VERSION,
  goIOSDownloadUrl,
  needsGoIOSInstall,
} from '../../src/scripts/goIosVersion';

// go-ios v1.0.134 does not keep the iOS 17+/26 XCTest session alive: WDA is
// terminated by the OS a few minutes after `runwda` starts, with the host side
// none the wiser. Measured on iOS 26.5.2 with an identical WDA 11.4.1 build —
// v1.0.134 died at 2m51s, v1.2.1 was still alive at 12min (see issue #187).
//
// The installer previously keyed its cache on an unversioned zip name, so a
// version bump alone would never reach anyone who had already installed.
// needsGoIOSInstall compares the recorded version instead.

describe('goIOSDownloadUrl', () => {
  it('points at the pinned version for each platform', () => {
    expect(goIOSDownloadUrl('mac')).to.equal(
      `https://github.com/danielpaulus/go-ios/releases/download/${GO_IOS_VERSION}/go-ios-mac.zip`,
    );
    expect(goIOSDownloadUrl('linux')).to.contain('go-ios-linux.zip');
  });

  it('is pinned at or above v1.2.1 — the first version verified to keep WDA alive', () => {
    const [major, minor] = GO_IOS_VERSION.replace(/^v/, '').split('.').map(Number);
    expect(major * 1000 + minor, `pinned ${GO_IOS_VERSION}`).to.be.at.least(1 * 1000 + 2);
  });
});

describe('needsGoIOSInstall', () => {
  it('installs when the binary is missing', () => {
    expect(
      needsGoIOSInstall({ binaryExists: false, installedVersion: GO_IOS_VERSION }),
    ).to.equal(true);
  });

  it('installs when no version was recorded (pre-upgrade install)', () => {
    expect(needsGoIOSInstall({ binaryExists: true, installedVersion: null })).to.equal(true);
  });

  it('UPGRADES when the recorded version is older than the pin', () => {
    expect(needsGoIOSInstall({ binaryExists: true, installedVersion: 'v1.0.134' })).to.equal(
      true,
    );
  });

  it('skips when the recorded version already matches the pin', () => {
    expect(
      needsGoIOSInstall({ binaryExists: true, installedVersion: GO_IOS_VERSION }),
    ).to.equal(false);
  });

  it('tolerates a recorded version with surrounding whitespace', () => {
    expect(
      needsGoIOSInstall({ binaryExists: true, installedVersion: `  ${GO_IOS_VERSION}\n` }),
    ).to.equal(false);
  });
});
