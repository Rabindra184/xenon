// What the Import button tells the user once the file dialog closes, kept out
// of App.tsx so every outcome is unit-testable. Null means nothing to say
// (the dialog was cancelled). Any outcome with a problem is an error toast.

export interface ImportOutcome {
  importedIds: string[];
  /** Basenames of files that were read and parsed. Empty on cancel. */
  files: string[];
  /** Basenames of files that could not be read or parsed. Empty on cancel. */
  unreadable: string[];
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function importFeedback(r: ImportOutcome): { message: string; kind: 'success' | 'error' } | null {
  if (r.files.length === 0 && r.unreadable.length === 0) return null;
  const couldntRead = r.unreadable.length ? `Couldn't read ${plural(r.unreadable.length, 'file')}` : '';

  if (r.importedIds.length > 0) {
    const imported = `Imported ${plural(r.importedIds.length, 'profile')}`;
    // A file that couldn't be read makes it an error, so the toast stays instead of
    // vanishing after a few seconds and hiding the corrupt file.
    if (couldntRead) return { message: `${imported}. ${couldntRead}.`, kind: 'error' };
    return { message: imported, kind: 'success' };
  }

  const none = r.files.length
    ? `No profiles found in ${r.files[0]}${r.files.length > 1 ? ` and ${plural(r.files.length - 1, 'more file')}` : ''}`
    : '';
  const message = none && couldntRead ? `${none}. ${couldntRead}.` : none || couldntRead;
  return { message, kind: 'error' };
}
