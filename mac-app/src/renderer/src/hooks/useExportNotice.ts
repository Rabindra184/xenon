import { useCallback, useEffect, useRef, useState } from 'react';
import type { Profile, ProfileExportResult } from '@shared/types';
import { PROFILES } from '../copy/profiles';
import { toast } from '../components/ui/toastStore';

export interface ExportNoticeInput {
  /** The open profile's id: another profile opened, from anywhere, makes the notice old news. */
  activeId: string | null;
  /** The Profiles sheet is open. */
  profilesOpen: boolean;
  /** Opens the Profiles sheet. */
  openProfiles(): void;
  /** The open profile now: read when Export is pressed. */
  current(): Profile | null;
  exportProfile(id: string): Promise<ProfileExportResult>;
}

export interface ExportNotice {
  /** The secret values the last export left out; the sheet says so until it is closed. */
  leftOut: string[];
  /** Saves the open profile to a file, and says what the file leaves out. */
  exportCurrent(): Promise<void>;
  /** The notice is old news: anything else done in the sheet, or the sheet closed. */
  clear(): void;
}

/**
 * Export saves the open profile. What the file leaves out is told on the
 * Profiles sheet; from the menu the sheet is closed, so it opens to say so. A
 * save that fails says so, rather than nothing.
 */
export function useExportNotice(i: ExportNoticeInput): ExportNotice {
  const [leftOut, setLeftOut] = useState<string[]>([]);
  // The same, from an export that opened the sheet to say so: held until the sheet is on screen.
  const [held, setHeld] = useState<string[] | null>(null);
  // The latest, for the export that reads it after an await.
  const profilesOpenRef = useRef(i.profilesOpen);
  profilesOpenRef.current = i.profilesOpen;

  const clear = useCallback(() => {
    setLeftOut([]);
    setHeld(null);
  }, []);

  const exportCurrent = async () => {
    const current = i.current();
    if (!current) return;
    try {
      const { saved, leftOut: left } = await i.exportProfile(current.id);
      if (saved && left.length > 0 && !profilesOpenRef.current) {
        setLeftOut([]);
        setHeld(left);
        i.openProfiles();
      } else {
        setLeftOut(saved ? left : []);
      }
    } catch (err) {
      console.error('[Xenon Control] could not export the profile:', err);
      clear();
      toast(PROFILES.exportFailed, 'error');
    }
  };

  // The notice for an export that opened the sheet comes into the sheet's live region a frame after
  // the sheet is on screen. Arriving with the sheet, the region would already hold it, and a screen
  // reader may not say it.
  const { profilesOpen } = i;
  useEffect(() => {
    if (!profilesOpen || held === null) return;
    const frame = requestAnimationFrame(() => {
      setLeftOut(held);
      setHeld(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [profilesOpen, held]);

  // Another profile opened (from anywhere) makes it old news.
  useEffect(() => {
    clear();
  }, [i.activeId, clear]);

  return { leftOut, exportCurrent, clear };
}
