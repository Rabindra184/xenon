import { describe, expect, it } from 'vitest';
import { importFeedback } from '../src/renderer/src/importFeedback';

describe('importFeedback', () => {
  it('says nothing when the dialog was cancelled', () => {
    expect(importFeedback({ importedIds: [], files: [], unreadable: [] })).toBeNull();
  });

  it('reports how many profiles came in', () => {
    expect(importFeedback({ importedIds: ['x', 'y'], files: ['a.json'], unreadable: [] })).toEqual({
      message: 'Imported 2 profiles',
      kind: 'success',
    });
    expect(importFeedback({ importedIds: ['x'], files: ['a.json'], unreadable: [] })).toEqual({
      message: 'Imported 1 profile',
      kind: 'success',
    });
  });

  it('mentions files that could not be read when others were imported, as an error that stays', () => {
    expect(importFeedback({ importedIds: ['x'], files: ['a.json'], unreadable: ['b.json'] })).toEqual({
      message: "Imported 1 profile. Couldn't read 1 file.",
      kind: 'error',
    });
    expect(importFeedback({ importedIds: ['x', 'y'], files: ['a.json'], unreadable: ['b.json', 'c.json'] })).toEqual({
      message: "Imported 2 profiles. Couldn't read 2 files.",
      kind: 'error',
    });
  });

  it('is an error whenever any file could not be read, and a success otherwise', () => {
    const kinds = [
      importFeedback({ importedIds: ['x'], files: ['a.json'], unreadable: [] }),
      importFeedback({ importedIds: ['x'], files: ['a.json'], unreadable: ['b.json'] }),
    ].map((f) => f?.kind);
    expect(kinds).toEqual(['success', 'error']);
  });

  it('names the file when it had no profiles in it', () => {
    expect(importFeedback({ importedIds: [], files: ['a.json'], unreadable: [] })).toEqual({
      message: 'No profiles found in a.json',
      kind: 'error',
    });
  });

  it('counts the other files when several had no profiles', () => {
    expect(importFeedback({ importedIds: [], files: ['a.json', 'b.json'], unreadable: [] })).toEqual({
      message: 'No profiles found in a.json and 1 more file',
      kind: 'error',
    });
    expect(importFeedback({ importedIds: [], files: ['a.json', 'b.json', 'c.json'], unreadable: [] })).toEqual({
      message: 'No profiles found in a.json and 2 more files',
      kind: 'error',
    });
  });

  it('says how many files could not be read when none were', () => {
    expect(importFeedback({ importedIds: [], files: [], unreadable: ['a.json', 'b.json'] })).toEqual({
      message: "Couldn't read 2 files",
      kind: 'error',
    });
    expect(importFeedback({ importedIds: [], files: [], unreadable: ['a.json'] })).toEqual({
      message: "Couldn't read 1 file",
      kind: 'error',
    });
  });

  it('reports both when nothing was imported and the files split into empty and unreadable', () => {
    expect(importFeedback({ importedIds: [], files: ['a.json'], unreadable: ['b.json'] })).toEqual({
      message: "No profiles found in a.json. Couldn't read 1 file.",
      kind: 'error',
    });
  });
});
