import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

const SCREENSHOT_DIRECTORY = 'screenshots';
const VIDEO_DIRECTORY = 'video';
const PERFORMANCE_DIRECTORY = 'performance';

export function prepareDirectory(sessionId: string) {
  [SCREENSHOT_DIRECTORY, VIDEO_DIRECTORY, PERFORMANCE_DIRECTORY].forEach((folder) => {
    fs.mkdirSync(path.join(config.sessionAssetsPath, sessionId, folder), { recursive: true });
  });
}

export function saveScreenShot(sessionId: string, screenshotBase64String: string): string {
  const assetPath = path.join(sessionId, SCREENSHOT_DIRECTORY, `${uuidv4()}.png`);
  const fullPath = path.join(config.sessionAssetsPath, assetPath);
  fs.writeFileSync(fullPath, screenshotBase64String, 'base64');
  console.log(`[AssetManager] Saved screenshot for session ${sessionId} at ${fullPath}`);
  return assetPath;
}

export function saveVideoRecording(sessionId: string, videoBase64String: string) {
  const assetPath = path.join(sessionId, VIDEO_DIRECTORY, `${sessionId}.mp4`);
  fs.writeFileSync(path.join(config.sessionAssetsPath, assetPath), videoBase64String, 'base64');
  return assetPath;
}

export function savePerformanceTrace(sessionId: string, traceBase64String: string) {
  const assetPath = path.join(sessionId, PERFORMANCE_DIRECTORY, `${sessionId}.zip`);
  fs.writeFileSync(path.join(config.sessionAssetsPath, assetPath), traceBase64String, 'base64');
  return assetPath;
}
