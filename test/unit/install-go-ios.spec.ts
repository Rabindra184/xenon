import { expect } from 'chai';
import { goIosStateMessage } from '../../src/device-managers/ios/goIosBinary';
import { installGoIosCheck } from '../../src/scripts/install-go-ios';

// go-ios ships inside the plugin from 2.18, so the old installer downloads
// nothing. It stays because the README's old command and older Xenon Control
// versions' Set up still run it, and must still succeed when go-ios is there.

const BIN = '/plugin/lib/src/device-managers/ios/vendor/go-ios/ios';

describe('the old go-ios installer, now a check', () => {
  it('exits 0 when go-ios comes with Xenon', () => {
    expect(installGoIosCheck('ok', BIN)).to.deep.equal({
      exitCode: 0,
      message: `go-ios v1.2.1 comes with this Xenon (${BIN}). Nothing to install.`,
    });
  });

  it('exits 0 off macOS, saying iPhones need a Mac', () => {
    expect(installGoIosCheck('not-mac', BIN)).to.deep.equal({
      exitCode: 0,
      message: goIosStateMessage('not-mac', BIN),
    });
  });

  it('exits 1 when the bundled go-ios is missing or cannot run', () => {
    expect(installGoIosCheck('missing', BIN)).to.deep.equal({
      exitCode: 1,
      message: goIosStateMessage('missing', BIN),
    });
    expect(installGoIosCheck('not-executable', BIN).exitCode).to.equal(1);
  });
});
