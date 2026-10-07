import { useCallback, useEffect, useRef, useState } from 'react';
import type { Profile, ProfileExportResult } from '@shared/types';
import { makeDefaultProfile } from '@shared/profileDefaults';
import { createDebouncer } from '../debounce';
import { importFeedback } from '../importFeedback';
import { toast } from '../components/ui/toastStore';
import { PROFILES } from '../copy/profiles';

/** How long typing settles before a profile is written to disk. */
const SAVE_DEBOUNCE_MS = 300;

export interface ProfilesApi {
  /** False until the saved profiles have been read, so "no profile" isn't shown for a moment at start. */
  loaded: boolean;
  profiles: Profile[];
  activeId: string | null;
  /** The active profile as edited on screen; the disk copy follows it after SAVE_DEBOUNCE_MS. */
  draft: Profile | null;
  select(id: string): void;
  /** Change the draft. It shows at once and is saved once typing settles. */
  update(fn: (p: Profile) => Profile): void;
  /** Write a pending edit now. */
  flush(): void;
  create(): Promise<void>;
  duplicate(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  rename(id: string, name: string): void;
  importProfiles(): Promise<void>;
  /** Saves the profile to a file the person picks. `leftOut` names the secret values the file does not carry. */
  exportProfile(id: string): Promise<ProfileExportResult>;
}

/** The saved profiles, which one is open, and the editable draft of it. */
export function useProfiles(): ProfilesApi {
  const [loaded, setLoaded] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  // The newest draft, so an edit is made on the latest one even when a render has not caught up yet.
  const draftRef = useRef<Profile | null>(null);
  draftRef.current = draft;
  const profilesRef = useRef<Profile[]>([]);
  profilesRef.current = profiles;

  useEffect(() => {
    void window.xenon.profiles.list().then((list) => {
      setProfiles(list);
      setActiveId(list[0]?.id ?? null);
      setLoaded(true);
    });
  }, []);

  // Sync the editable draft when the active profile changes.
  useEffect(() => {
    const p = profiles.find((x) => x.id === activeId) ?? null;
    setDraft(p ? structuredClone(p) : null);
  }, [activeId, profiles]);

  // The draft updates immediately (responsive typing); the disk write is
  // debounced so we don't save a profile on every keystroke. Anything that
  // could lose a pending edit — unmount, profile switch, server start —
  // flushes first.
  const saver = useRef(
    createDebouncer((next: Profile) => {
      window.xenon.profiles.save(next).then((saved) => {
        setProfiles((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      });
    }, SAVE_DEBOUNCE_MS)
  ).current;

  useEffect(() => {
    // Window close / reload can tear the renderer down inside the debounce
    // window; flush so the last keystrokes are never lost.
    const flush = () => saver.flush();
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      saver.flush();
    };
  }, [saver]);

  const persist = useCallback(
    (next: Profile) => {
      draftRef.current = next;
      setDraft(next);
      saver.call(next);
    },
    [saver]
  );

  const update = useCallback(
    (fn: (p: Profile) => Profile) => {
      const current = draftRef.current;
      if (!current) return;
      persist(fn(current));
    },
    [persist]
  );

  const flush = useCallback(() => saver.flush(), [saver]);

  const select = useCallback(
    (id: string) => {
      saver.flush(); // don't let in-flight edits to the old profile get dropped
      setActiveId(id);
    },
    [saver]
  );

  const create = async () => {
    // The pending save holds one edit, and the new profile's first edit would
    // replace it: save the profile on screen first, as select does.
    saver.flush();
    const fresh = makeDefaultProfile({ id: crypto.randomUUID(), now: Date.now() });
    const saved = await window.xenon.profiles.save(fresh);
    setProfiles((prev) => [...prev, saved]);
    setActiveId(saved.id);
  };

  const duplicate = async (id: string) => {
    saver.flush(); // the copy is made from the saved profile, so save its pending edit first
    const copy = await window.xenon.profiles.duplicate(id);
    if (copy) {
      setProfiles((prev) => [...prev, copy]);
      setActiveId(copy.id);
    }
  };

  const remove = async (id: string) => {
    // A pending edit is always the open profile's. If that profile is going, saving it afterwards
    // would bring it back.
    if (id === activeId) saver.cancel();
    const remaining = await window.xenon.profiles.delete(id);
    setProfiles(remaining);
    if (activeId === id) setActiveId(remaining[0]?.id ?? null);
  };

  // The open profile is renamed through the draft, like any other edit. Another
  // profile has no draft, so its new name is saved straight away.
  const rename = (id: string, name: string) => {
    const current = draftRef.current;
    if (current && current.id === id) {
      persist({ ...current, name });
      return;
    }
    const other = profilesRef.current.find((p) => p.id === id);
    if (!other) return;
    void window.xenon.profiles.save({ ...other, name }).then((saved) => {
      setProfiles((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    });
  };

  const importProfiles = async () => {
    const result = await window.xenon.profiles.import();
    setProfiles(result.profiles);
    if (result.importedIds.length) setActiveId(result.importedIds[0]);
    const feedback = importFeedback(result);
    if (feedback) toast(feedback.message, feedback.kind);
  };

  const exportProfile = async (id: string) => {
    // The disk copy is what is exported, so save a pending edit first, as duplicate does.
    saver.flush();
    const result = await window.xenon.profiles.export(id);
    if (result.saved) toast(PROFILES.exported);
    return result;
  };

  return { loaded, profiles, activeId, draft, select, update, flush, create, duplicate, remove, rename, importProfiles, exportProfile };
}
