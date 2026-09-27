import * as fs from 'fs';
import * as path from 'path';

/**
 * `<recordings>/<id>/` for a video at `<recordings>/<id>/video/<file>.mp4`:
 * the directory that also holds the marks' images, timing.json and the
 * annotated-export cache. Derived from file_path, never from the row id —
 * see selectOrphanDirectories for why the id is not a safe key.
 */
export function recordingDirOf(videoFilePath: string): string {
  return path.dirname(path.dirname(videoFilePath));
}

/**
 * Remove deleted recordings' files: each phone's recording directory, and the
 * group's composite directory when `groupDir` is given (null while rows of the
 * group remain). Refuses anything that is not strictly inside `base`, and the
 * `_groups` parent itself. Best effort — a directory that can't be removed is
 * left for CleanupService's orphan sweep, which will find no row pointing into
 * it. Returns the directories removed.
 */
export function removeRecordingFiles(
  filePaths: string[],
  groupDir: string | null,
  base: string,
): string[] {
  const root = path.resolve(base);
  const groupsParent = path.join(root, '_groups');
  const targets = filePaths
    .filter(Boolean)
    .map(recordingDirOf)
    .concat(groupDir === null ? [] : [groupDir])
    .map((d) => path.resolve(d));
  const removed: string[] = [];
  Array.from(new Set(targets)).forEach((dir) => {
    if (!dir.startsWith(root + path.sep) || dir === groupsParent) return;
    if (!fs.existsSync(dir)) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch {
      // Left for the orphan sweep.
    }
  });
  return removed;
}
