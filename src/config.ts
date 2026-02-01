import * as os from 'os';
import * as path from 'path';
const basePath = path.join(os.homedir(), '.cache', 'xenon');

export interface Config {
  cacheDir: string;
  databasePath: string;
  videoSavePath: string;
  screenshotSavePath: string;
  logFilePath: string;
  takeScreenshotsFor: Array<string>;
}

export const config = {
  cacheDir: basePath,
  databasePath: `${basePath}/xenon.db`,
  sessionAssetsPath: path.join(basePath, 'assets', 'sessions'),
  appsPath: path.join(basePath, 'apps'),
  takeScreenshotsFor: [
    'click',
    'setUrl',
    'setValue',
    'performActions',
    'clear',
    'swipe',
    'scroll',
    'dragAndDrop',
    'back',
    'forward',
  ],
};
