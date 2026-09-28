import { describe, expect, it } from 'vitest';
import XenonApiService from './index';

// A session's screenshots, video and performance trace are stored as
// `<sessionId>/<kind>/<file>` and served, behind the login and the session's
// team check, by GET /xenon/api/session/:sessionId/asset/:kind/:file.
// The dashboard used to link them under /xenon/assets/, which only ever
// served the web app's own files, so these views showed nothing.
describe('XenonApiService.getAssetUrl', () => {
  it('links a stored session file to the session asset route', () => {
    expect(XenonApiService.getAssetUrl('s-1/video/s-1.mp4')).toBe(
      '/xenon/api/session/s-1/asset/video/s-1.mp4',
    );
    expect(XenonApiService.getAssetUrl('s-1/screenshots/a1b2.png')).toBe(
      '/xenon/api/session/s-1/asset/screenshots/a1b2.png',
    );
  });

  it('accepts a leading slash and Windows separators', () => {
    expect(XenonApiService.getAssetUrl('/s-1/performance/s-1.zip')).toBe(
      '/xenon/api/session/s-1/asset/performance/s-1.zip',
    );
    expect(XenonApiService.getAssetUrl('s-1\\video\\s-1.mp4')).toBe(
      '/xenon/api/session/s-1/asset/video/s-1.mp4',
    );
  });

  it('encodes each part', () => {
    expect(XenonApiService.getAssetUrl('s 1/video/a#b.mp4')).toBe(
      '/xenon/api/session/s%201/asset/video/a%23b.mp4',
    );
  });

  it('gives nothing for a missing path, or one that is not a stored session file', () => {
    expect(XenonApiService.getAssetUrl(undefined)).toBe('');
    expect(XenonApiService.getAssetUrl(null)).toBe('');
    expect(XenonApiService.getAssetUrl('')).toBe('');
    expect(XenonApiService.getAssetUrl('/Users/me/video.mp4')).toBe('');
    expect(XenonApiService.getAssetUrl('s-1/video')).toBe('');
  });
});
