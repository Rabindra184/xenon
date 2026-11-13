import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteRecording,
  getRecording,
  listRecordings,
  RecordingConflict,
  RecordingRequestError,
  sourceMp4Url,
  startRecording,
} from './recordings';
import * as recordings from './recordings';

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

describe('startRecording', () => {
  const H1 = 'http://10.0.0.1:4723';
  const H2 = 'http://10.0.0.2:4723';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Two servers can each have an emulator-5554: each entry names its server.
  it('names each phone by udid and host, and nothing more', async () => {
    const f = reply(202, { groupId: 'g1', recordings: [] });
    vi.stubGlobal('fetch', f);
    await startRecording(
      [
        { udid: 'emulator-5554', host: H1, name: 'Pixel 8' } as { udid: string; host: string },
        { udid: 'emulator-5554', host: H2 },
      ],
      { note: 'n' },
    );
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/xenon/api/recordings');
    expect(JSON.parse(init.body)).toEqual({
      udids: [
        { udid: 'emulator-5554', host: H1 },
        { udid: 'emulator-5554', host: H2 },
      ],
      note: 'n',
    });
  });

  it('turns a 409 into a RecordingConflict that keeps the server’s error and message', async () => {
    vi.stubGlobal(
      'fetch',
      reply(409, { error: 'ambiguous_phone', message: 'Two servers…', hosts: [H1, H2] }),
    );
    const err = await startRecording([{ udid: 'emulator-5554', host: H1 }]).catch((e) => e);
    expect(err).toBeInstanceOf(RecordingConflict);
    expect(err.error).toBe('ambiguous_phone');
    expect(err.message).toBe('Two servers…');
  });

  // The server answers a phone sent twice with 400 duplicate_phone, no message.
  it('turns a duplicate_phone refusal into a RecordingConflict too', async () => {
    vi.stubGlobal('fetch', reply(400, { error: 'duplicate_phone' }));
    const err = await startRecording([
      { udid: 'u', host: H1 },
      { udid: 'u', host: H1 },
    ]).catch((e) => e);
    expect(err).toBeInstanceOf(RecordingConflict);
    expect(err.error).toBe('duplicate_phone');
  });

  it('no longer offers addDevice, which nothing called', () => {
    expect('addDevice' in recordings).toBe(false);
  });
});
