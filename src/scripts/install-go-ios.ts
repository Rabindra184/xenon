// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import unzipper from 'unzipper';
import fs from 'fs';
import path from 'path';
import download from 'download';
import { cachePath, isMac } from '../helpers';
import { waitUntil } from 'async-wait-until';
import log from '../logger';
import {
  GO_IOS_VERSION,
  GO_IOS_VERSION_FILE,
  goIOSDownloadUrl,
  needsGoIOSInstall,
} from './goIosVersion';

const logger = log.scope('GoIOSInstall');
const basePath = cachePath('goIOS');
const versionFile = path.join(basePath, GO_IOS_VERSION_FILE);

/** Which go-ios version the cache directory currently holds, if recorded. */
function readInstalledVersion(): string | null {
  try {
    return fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8') : null;
  } catch {
    return null;
  }
}

async function main() {
  const platform = isMac() ? 'mac' : 'linux';
  const source = goIOSDownloadUrl(platform);
  const binaryPath = `${basePath}/ios`;

  const installedVersion = readInstalledVersion();
  const mustInstall = needsGoIOSInstall({
    binaryExists: fs.existsSync(binaryPath),
    installedVersion,
  });

  if (!mustInstall) {
    logger.info(`go-iOS ${GO_IOS_VERSION} already installed`);
    return;
  }

  if (installedVersion && installedVersion.trim() !== GO_IOS_VERSION) {
    // Upgrade path. This matters: go-ios <= v1.0.134 fails to keep the iOS
    // 17+/26 XCTest session alive, so WDA is terminated minutes after runwda
    // starts (see goIosVersion.ts and issue #187). The previous cache check
    // keyed on an unversioned zip name, so existing installs never upgraded.
    logger.info(`Upgrading go-iOS ${installedVersion.trim()} -> ${GO_IOS_VERSION}`);
    // Remove the stale binary so the unzip cannot silently keep the old one.
    try {
      if (fs.existsSync(binaryPath)) fs.unlinkSync(binaryPath);
    } catch (e) {
      logger.warn(`Could not remove stale go-ios binary: ${e}`);
    }
  } else {
    logger.info(`goIOS not found, downloading ${GO_IOS_VERSION}..`);
  }

  if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });
  await download(source, basePath);
  await unzipgoIOS(platform);
  await setExecutePermission();

  // Record the version only after the binary is in place, so an interrupted
  // install is retried rather than being mistaken for a good one.
  try {
    fs.writeFileSync(versionFile, GO_IOS_VERSION);
  } catch (e) {
    logger.warn(`Could not record go-ios version: ${e}`);
  }
}

(async () => await main())();

function unzipgoIOS(platform) {
  fs.createReadStream(`${basePath}/go-ios-${platform}.zip`).pipe(
    unzipper.Extract({ path: `${basePath}/` }),
  );
}

async function setExecutePermission() {
  await waitUntil(() => fs.existsSync(`${basePath}/ios`));
  fs.chmod(`${basePath}/ios`, 0o775, (error) => {
    if (error) {
      logger.error(`Error changing permissions: ${error}`);
      return;
    }
    logger.info('Permissions are changed for the file!');
  });
}
