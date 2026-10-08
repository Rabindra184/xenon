import { useCallback, useEffect, useRef, useState } from 'react';
import type { Profile, ProfileExportResult } from '@shared/types';
import { makeDefaultProfile } from '@shared/profileDefaults';
import { createDebouncer } from '../debounce';
import { draftTakesAnswer } from '../draftAnswer';
import { importFeedback } from '../importFeedback';
import { profileToOpen } from '../profileChoice';
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

/**
 * The saved profiles, which one is open, and the editable draft of it.
 *
 * The draft is read from the saved list when a profile is opened: what is on
 * screen is at least as new as anything the list holds, and a save coming back
 * must not put an older copy under the next keystroke. Two exceptions: a save's
 * answer, which the draft takes while it is still the copy that was saved and
 * no edit waits (draftTakesAnswer: main may have moved a secret out of it), and
 * a list the main process sends back after a delete or an import (a secret may
 * have moved to the Keychain), which the open profile is read from again unless
 * an edit of it is still waiting.
 */
export function useProfiles(): ProfilesApi {
  const [loaded, setLoaded] = useState(false);
  const [profiles, setProfilesState] = useState<Profile[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [draft, setDraftState] = useState<Profile | null>(null);
  // The newest values, so a handler acts on them even when a render has not caught up yet.
  const profilesRef = useRef<Profile[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const draftRef = useRef<Profile | null>(null);
  // The profile whose edit waits in `saver`; null when none does.
  const pendingIdRef = useRef<string | null>(null);

  const setList = useCallback((next: Profile[]) => {
    profilesRef.current = next;
    setProfilesState(next);
  }, []);

  // The draft updates immediately (responsive typing); the disk write is
  // debounced so we don't save a profile on every keystroke. Anything that
  // could lose a pending edit — unmount, profile switch, server start —
  // flushes first.
  const saver = useRef(
    createDebouncer((next: Profile) => {
      pendingIdRef.current = null;
      store(next);
    }, SAVE_DEBOUNCE_MS)
  ).current;

  /**
   * Writes a profile to disk. The list holds this copy at once, so reopening
   * the profile before the write is answered shows it; the answer (the copy as
   * stored, with its new time and without the secret values main moved to the
   * Keychain) replaces it only if nothing newer took its place, in the list and
   * in the draft.
   */
  function store(next: Profile) {
    setList(profilesRef.current.map((p) => (p.id === next.id ? next : p)));
    void window.xenon.profiles.save(next).then((saved) => {
      setList(profilesRef.current.map((p) => (p === next ? saved : p)));
      if (draftTakesAnswer(draftRef.current, next, pendingIdRef.current)) {
        draftRef.current = saved;
        setDraftState(saved);
      }
    });
  }

  /**
   * Opens a profile: it becomes the active one, and its draft is a copy of the saved one. The main
   * process remembers which, so a window closed and opened again (or the next launch) opens it too.
   */
  const open = useCallback(
    (id: string | null) => {
      // An edit still waiting belongs to the profile being left. Save it now, or the next
      // profile's first edit would replace it.
      if (id !== draftRef.current?.id) saver.flush();
      const found = profilesRef.current.find((p) => p.id === id) ?? null;
      const next = found ? structuredClone(found) : null;
      if (id !== activeIdRef.current) void window.xenon.profiles.setOpen(id);
      activeIdRef.current = id;
      setActiveIdState(id);
      draftRef.current = next;
      setDraftState(next);
    },
    [saver]
  );

  /** Reads the open profile from the list again, unless an edit of it is waiting: that one is newer. */
  const reseed = useCallback(() => {
    if (pendingIdRef.current === null) open(activeIdRef.current);
  }, [open]);

  useEffect(() => {
    void Promise.all([window.xenon.profiles.list(), window.xenon.profiles.lastOpen()]).then(([list, lastOpen]) => {
      setList(list);
      open(profileToOpen(list, lastOpen));
      setLoaded(true);
    });
  }, [open, setList]);

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
      setDraftState(next);
      pendingIdRef.current = next.id;
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
      // The profile already open keeps its draft: it may hold an edit that is not saved yet.
      if (id !== activeIdRef.current) open(id);
    },
    [open]
  );

  const create = async () => {
    // The pending save holds one edit, and the new profile's first edit would
    // replace it: save the profile on screen first, as select does.
    saver.flush();
    const fresh = makeDefaultProfile({ id: crypto.randomUUID(), now: Date.now() });
    const saved = await window.xenon.profiles.save(fresh);
    setList([...profilesRef.current, saved]);
    open(saved.id);
  };

  const duplicate = async (id: string) => {
    saver.flush(); // the copy is made from the saved profile, so save its pending edit first
    const copy = await window.xenon.profiles.duplicate(id);
    if (copy) {
      setList([...profilesRef.current, copy]);
      open(copy.id);
    }
  };

  const remove = async (id: string) => {
    // If the profile that is going has an edit waiting, saving it afterwards would bring it back.
    if (pendingIdRef.current === id) {
      saver.cancel();
      pendingIdRef.current = null;
    }
    const remaining = await window.xenon.profiles.delete(id);
    setList(remaining);
    if (activeIdRef.current === id) open(remaining[0]?.id ?? null);
    else reseed();
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
    store({ ...other, name });
  };

  const importProfiles = async () => {
    // The list that comes back is read from disk, so the open profile's waiting edit goes there first.
    saver.flush();
    const result = await window.xenon.profiles.import();
    setList(result.profiles);
    if (result.importedIds.length) open(result.importedIds[0]);
    else reseed();
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
