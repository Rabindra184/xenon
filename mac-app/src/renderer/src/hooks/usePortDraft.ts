import { useEffect, useState } from 'react';
import type { Profile } from '@shared/types';
import { parsePort } from '../validation';

export interface PortDraft {
  /** What the port box holds, which may be half-typed or empty. */
  portText: string;
  /** Which profile the box was filled from; until it is the open one, the box is not that profile's port. */
  portTextFor: string | null;
  /** Why the box's text is not a port, or null when it is one. */
  portError: string | null;
  /** The box was typed in: a valid port goes to the profile at once, an invalid one stays in the box. */
  onPortChange(text: string): void;
  /** A port chosen for the person ("Use port N"): the box shows it, and the profile has it. */
  setPort(port: number): void;
}

/**
 * The port box's own text, so a half-typed or cleared value never reaches the
 * profile as NaN. It is filled from the profile when a different profile is
 * opened, and not when a save comes back, which would overwrite what is being
 * typed. A valid port is handed to `onPort`.
 */
export function usePortDraft(draft: Profile | null, onPort: (port: number) => void): PortDraft {
  const [portText, setPortText] = useState('');
  const [portTextFor, setPortTextFor] = useState<string | null>(null);
  useEffect(() => {
    setPortText(draft ? String(draft.server.port) : '');
    setPortTextFor(draft?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id]);

  const portParse = parsePort(portText);
  const portError = portParse.ok ? null : portParse.error;

  const onPortChange = (text: string) => {
    setPortText(text);
    const res = parsePort(text);
    if (res.ok) onPort(res.value);
  };

  const setPort = (port: number) => onPortChange(String(port));

  return { portText, portTextFor, portError, onPortChange, setPort };
}
