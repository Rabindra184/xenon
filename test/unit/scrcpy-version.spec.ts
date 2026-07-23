import { expect } from 'chai';
import fs from 'fs';
import {
  SCRCPY_SERVER_VERSION,
  scrcpyServerJarFilename,
  scrcpyServerJarPath,
} from '../../src/device-managers/android/scrcpyVersion';

describe('scrcpyVersion', () => {
  it('derives the jar filename from the single version constant', () => {
    expect(scrcpyServerJarFilename()).to.equal(`scrcpy-server-${SCRCPY_SERVER_VERSION}.jar`);
  });
  it('the vendored jar exists on disk at the resolved path', () => {
    expect(fs.existsSync(scrcpyServerJarPath()), scrcpyServerJarPath()).to.equal(true);
  });
});
