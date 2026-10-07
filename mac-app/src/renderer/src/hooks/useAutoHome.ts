import { useCallback, useEffect, useRef, useState } from 'react';
import type { Profile } from '@shared/types';

/** The Appium folder an empty setting resolves to, where it was found, and the path as shown (with `~`). */
export interface AutoHome {
  path: string;
  source: string;
  display: string;
}

export interface AutoHomeApi {
  autoHome: AutoHome | null;
  /** Reads it again for `shown`, and keeps the answer only if that profile is still the open one. */
  reread(shown: Profile): Promise<void>;
}

/**
 * What an empty Appium folder actually resolves to on this machine, so
 * "automatic" is visible rather than magic. Read again when another profile is
 * opened or its Appium folder changes.
 */
export function useAutoHome(draft: Profile | null): AutoHomeApi {
  const [autoHome, setAutoHome] = useState<AutoHome | null>(null);
  const draftRef = useRef<Profile | null>(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!draft) return;
    let live = true;
    window.xenon.server.resolvedAppiumHome(draft).then((r) => live && setAutoHome(r));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, draft?.server.appiumHome]);

  const reread = useCallback(async (shown: Profile) => {
    const home = await window.xenon.server.resolvedAppiumHome(shown);
    if (draftRef.current?.id === shown.id) setAutoHome(home);
  }, []);

  return { autoHome, reread };
}
