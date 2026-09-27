import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteRecording,
  getRecording,
  listRecordings,
  RecordingRequestError,
  sourceMp4Url,
} from './recordings';

const reply = (status: number, body?: unknown) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });

describe('recordings library API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists with only the filters that are set', async () => {
    const f = reply(200, { recordings: [] });
    vi.stubGlobal('fetch', f);
    await listRecordings({ udid: 'U1', q: '', cursor: 'c1', limit: 50 });
    expect(f).toHaveBeenCalledWith('/xenon/api/recordings?udid=U1&cursor=c1&limit=50');
    await listRecordings();
    expect(f).toHaveBeenLastCalledWith('/xenon/api/recordings');
  });

  it('turns a refusal into a RecordingRequestError with its code', async () => {
    vi.stubGlobal('fetch', reply(404, { error: 'not_found' }));
    await expect(getRecording('g1')).rejects.toMatchObject({ status: 404, code: 'not_found' });
    vi.stubGlobal('fetch', reply(403, { error: 'not_owner' }));
    const err = await deleteRecording('g1').catch((e) => e);
    expect(err).toBeInstanceOf(RecordingRequestError);
    expect(err.code).toBe('not_owner');
  });

  it('deletes with DELETE', async () => {
    const f = reply(204);
    vi.stubGlobal('fetch', f);
    await deleteRecording('g 1');
    expect(f).toHaveBeenCalledWith('/xenon/api/recordings/g%201', { method: 'DELETE' });
  });

  it('builds the player’s and the download’s video URLs', () => {
    expect(sourceMp4Url('g1', 'r1')).toBe('/xenon/api/recordings/g1/source.mp4?recordingId=r1');
    expect(sourceMp4Url('g1', 'r1', true)).toBe(
      '/xenon/api/recordings/g1/source.mp4?recordingId=r1&download=1',
    );
  });
});
