import {
  annotatedMp4Url,
  bundleZipUrl,
  compositeMp4Url,
  RecordingRequestError,
  sourceMp4Url,
  videosZipUrl,
  type RecordingSummary,
} from '../../api-service/recordings';

export interface DownloadItem {
  key: string;
  label: string;
  url: string;
}

/** The Download menu: the group's files, then each phone's video (and annotated one). */
export function downloadItems(s: RecordingSummary): DownloadItem[] {
  const items: DownloadItem[] = [
    { key: 'zip', label: 'All videos (zip)', url: videosZipUrl(s.groupId) },
  ];
  if (s.hasComposite) {
    items.push({ key: 'composite', label: 'Side-by-side video', url: compositeMp4Url(s.groupId) });
  }
  items.push({ key: 'bundle', label: 'Proof bundle', url: bundleZipUrl(s.groupId) });
  s.phones
    .filter((p) => p.status !== 'FAILED' && p.status !== 'DISCARDED')
    .forEach((p) => {
      items.push({
        key: `video-${p.recordingId}`,
        label: `${p.name}: video`,
        url: sourceMp4Url(s.groupId, p.recordingId, true),
      });
      if (p.annotationCount > 0) {
        items.push({
          key: `annotated-${p.recordingId}`,
          label: `${p.name}: video with annotations`,
          url: annotatedMp4Url(s.groupId, p.recordingId),
        });
      }
    });
  return items;
}

/** The server decides; this only hides a button that would be refused. */
export function canDelete(
  s: RecordingSummary,
  me: { userId?: string | null; role?: string | null } | null,
): boolean {
  if (!me) return false;
  if (me.role === 'ADMIN' || me.role === 'SUPER_ADMIN') return true;
  return !!s.startedBy && !!me.userId && s.startedBy.id === me.userId;
}

export function deleteErrorMessage(e: unknown): string {
  if (e instanceof RecordingRequestError) {
    if (e.code === 'not_owner')
      return 'Only the person who recorded it, or an admin, can delete it.';
    if (e.code === 'recording_in_progress')
      return 'It’s still recording. Stop it on Live devices first.';
    if (e.status === 404) return 'It was already deleted, or it’s on phones you can’t see.';
  }
  return `Couldn’t delete the recording: ${e instanceof Error ? e.message : String(e)}`;
}

/** Start a browser download of a same-origin URL (cookies go with it). */
export function startDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
