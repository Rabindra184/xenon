/**
 * The go-ios installer before 2.18, now only a check.
 *
 * go-ios ships inside the plugin (scripts/fetch-go-ios.js takes it from the
 * pinned npm release when Xenon is built), so this downloads nothing. It stays,
 * compiled to lib/src/scripts/install-go-ios.js, so the README's old command
 * and older Xenon Control versions' Set up, which run it, still succeed. It
 * exits 0 when this Xenon's go-ios can run, and off macOS, where there is
 * nothing to install; 1 when go-ios is missing or can't be run.
 */
import log from '../logger';
import {
  checkGoIosBinary,
  goIosBinaryPath,
  GoIosBinaryState,
  goIosStateMessage,
} from '../device-managers/ios/goIosBinary';
import { GO_IOS_VERSION } from './goIosVersion';

const logger = log.scope('GoIOSInstall');

/** What the check says about go-ios's `state` at `binaryPath`, and the code it exits with. */
export function installGoIosCheck(
  state: GoIosBinaryState,
  binaryPath: string,
): { exitCode: 0 | 1; message: string } {
  if (state === 'ok') {
    return {
      exitCode: 0,
      message: `go-ios ${GO_IOS_VERSION} comes with this Xenon (${binaryPath}). Nothing to install.`,
    };
  }
  return { exitCode: state === 'not-mac' ? 0 : 1, message: goIosStateMessage(state, binaryPath) };
}

function main(): void {
  const binaryPath = goIosBinaryPath();
  const { exitCode, message } = installGoIosCheck(checkGoIosBinary(binaryPath), binaryPath);
  if (exitCode === 0) logger.info(message);
  else logger.error(message);
  process.exitCode = exitCode;
}

if (require.main === module) main();
