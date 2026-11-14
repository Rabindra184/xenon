import { describe, expect, it } from 'vitest';
import type { RecordingSummary } from '../../api-service/recordings';
import { RecordingRequestError } from '../../api-service/recordings';
import { canDelete, deleteErrorMessage, downloadItems } from './recordingActions';

const summary = (over: Partial<RecordingSummary> = {}): RecordingSummary => ({
  groupId: 'g1',
  startedAt: '2026-09-27T10:00:00.000Z',
  endedAt: '2026-09-27T10:04:12.000Z',
  durationMs: 252_000,
  status: 'done',
  phones: [
    {
      recordingId: 'r1',
      udid: 'U1',
      host: 'http://127.0.0.1:4723',
      name: 'Galaxy S9+',
      platform: 'android',
      status: 'STOPPED',
      offsetMs: 0,
      durationMs: 252_000,
      failReason: null,
      annotationCount: 2,
    },
    {
      recordingId: 'r2',
      udid: 'U2',
      host: 'http://127.0.0.1:4723',
      name: 'iPhone 17',
      platform: 'ios',
      status: 'STOPPED',
      offsetMs: 42_000,
      durationMs: 200_000,
      failReason: null,
      annotationCount: 0,
    },
    {
      recordingId: 'r3',
      udid: 'U3',
      host: 'http://127.0.0.1:4723',
      name: 'Pixel',
      platform: 'android',
      status: 'FAILED',
      offsetMs: 0,
      durationMs: null,
      failReason: 'no frames',
      annotationCount: 0,
    },
  ],
  startedBy: { id: 'usr_alice', name: 'Alice' },
  bookmarkCount: 1,
  annotationCount: 2,
  keptUntil: '2026-10-27T10:00:00.000Z',
  sizeBytes: 100,
  hasComposite: true,
  ...over,
});

describe('recording actions', () => {
  it('offers the group downloads, and per phone the video and, with marks, the annotated one', () => {
    expect(downloadItems(summary()).map((i) => [i.label, i.url])).toEqual([
      ['All videos (zip)', '/xenon/api/recordings/g1/videos.zip'],
      ['Side-by-side video', '/xenon/api/recordings/g1/composite.mp4'],
      ['Proof bundle', '/xenon/api/recordings/g1/bundle.zip'],
      ['Galaxy S9+: video', '/xenon/api/recordings/g1/source.mp4?recordingId=r1&download=1'],
      [
        'Galaxy S9+: video with annotations',
        '/xenon/api/recordings/g1/exports/annotated.mp4?recordingId=r1',
      ],
      ['iPhone 17: video', '/xenon/api/recordings/g1/source.mp4?recordingId=r2&download=1'],
    ]);
    expect(downloadItems(summary({ hasComposite: false })).map((i) => i.key)).not.toContain(
      'composite',
    );
  });

  // A phone added while the group recorded starts a new part of the
  // side-by-side video: each part is its own download, in order.
  it('offers each part of the side-by-side video, part 1 without a number in its address', () => {
    const s = summary({
      compositeParts: [
        { part: 1, endedEarly: false, endedAt: null },
        { part: 2, endedEarly: true, endedAt: '2026-09-27T10:03:00.000Z' },
      ],
    });
    expect(
      downloadItems(s)
        .filter((i) => i.key.startsWith('composite'))
        .map((i) => [i.label, i.url]),
    ).toEqual([
      ['Side-by-side video, part 1', '/xenon/api/recordings/g1/composite.mp4'],
      ['Side-by-side video, part 2', '/xenon/api/recordings/g1/composite.mp4?part=2'],
    ]);
    // One part (or a server that doesn't list them): one download, as before.
    for (const one of [
      summary({ compositeParts: [{ part: 1, endedEarly: false, endedAt: null }] }),
      summary(),
    ]) {
      expect(
        downloadItems(one)
          .filter((i) => i.key.startsWith('composite'))
          .map((i) => [i.label, i.url]),
      ).toEqual([['Side-by-side video', '/xenon/api/recordings/g1/composite.mp4']]);
    }
    // A lone later part (the caller may have only that one) keeps its address.
    expect(
      downloadItems(summary({ compositeParts: [{ part: 2, endedEarly: false, endedAt: null }] }))
        .filter((i) => i.key.startsWith('composite'))
        .map((i) => [i.label, i.url]),
    ).toEqual([['Side-by-side video', '/xenon/api/recordings/g1/composite.mp4?part=2']]);
  });

  it("names each of two servers' phones of one udid with its server", () => {
    const [one, two] = summary().phones;
    const s = summary({
      phones: [
        { ...one, udid: 'emulator-5554', host: 'http://10.0.0.1:4723', annotationCount: 0 },
        { ...two, udid: 'emulator-5554', host: 'http://10.0.0.2:4723', name: 'Galaxy S9+' },
      ],
    });
    expect(
      downloadItems(s)
        .map((i) => i.label)
        .slice(3),
    ).toEqual(['Galaxy S9+ on 10.0.0.1:4723: video', 'Galaxy S9+ on 10.0.0.2:4723: video']);
  });

  it('lets the person who recorded it, or an admin, delete', () => {
    expect(canDelete(summary(), { userId: 'usr_alice', role: 'MEMBER' })).toBe(true);
    expect(canDelete(summary(), { userId: 'usr_bob', role: 'MEMBER' })).toBe(false);
    expect(canDelete(summary(), { userId: 'usr_bob', role: 'ADMIN' })).toBe(true);
    expect(canDelete(summary(), { userId: 'usr_bob', role: 'SUPER_ADMIN' })).toBe(true);
    expect(canDelete(summary({ startedBy: null }), { userId: 'usr_alice', role: 'MEMBER' })).toBe(
      false,
    );
    expect(canDelete(summary(), null)).toBe(false);
  });

  it('says why a delete failed', () => {
    expect(deleteErrorMessage(new RecordingRequestError(403, 'not_owner'))).toBe(
      'Only the person who recorded it, or an admin, can delete it.',
    );
    expect(deleteErrorMessage(new RecordingRequestError(409, 'recording_in_progress'))).toBe(
      'It’s still recording. Stop it on Live devices first.',
    );
    expect(deleteErrorMessage(new RecordingRequestError(404, 'not_found'))).toBe(
      'It was already deleted, or it’s on phones you can’t see.',
    );
    expect(deleteErrorMessage(new Error('boom'))).toBe('Couldn’t delete the recording: boom');
  });
});
