import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SecretKey, SecretSaveResult } from '@shared/types';
import { isProfileSecret } from '@shared/secrets';
import { KEY_ORDER } from '../../keyRows';
import { KEYS } from '../../copy/keys';
import { COMMON } from '../../copy/common';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { toast } from '../../components/ui/toastStore';

export interface SecretsApi {
  /**
   * Which Keychain secrets hold a value: an app-wide one for the whole app, and
   * the open profile's own cloud key and proxy password. Empty until the first answer.
   */
  saved: Partial<Record<SecretKey, boolean>>;
  /** The open profile's saved proxy password has a colon in it (R53). */
  proxyPasswordHasColon: boolean;
  /**
   * Stores a value in the Keychain and says so: an app-wide secret, or the own
   * secret of the profile `profileId` (the one Save was pressed on, R51). When
   * it can't, it says why and throws, so the box keeps what was typed for
   * another try.
   */
  save(key: SecretKey, value: string, profileId: string): Promise<void>;
  /**
   * Asks whether to clear a secret: an app-wide one, or the own secret of the
   * profile `profileId` (the one Clear was pressed on). Only the Keychain value
   * goes: whether a profile uses an app-wide key ("Used by this profile") is its
   * own switch. Once it is cleared, the cursor goes to the box `fieldId`, since
   * Clear itself goes.
   */
  askClear(key: SecretKey, fieldId: string, profileId: string): void;
  /** The confirmation window; render it once. */
  dialog: ReactNode;
}

/**
 * The Keychain secrets Settings shows, shared by Essentials and Keys & accounts,
 * for the open profile `profileId` (Settings is drawn afresh for another). Their
 * status is read again whenever `refreshOn` changes (a tab, or which secrets
 * the profile uses: a save can move a typed secret into the Keychain).
 */
export function useSecrets(profileId: string, refreshOn: unknown): SecretsApi {
  const [saved, setSaved] = useState<Partial<Record<SecretKey, boolean>>>({});
  const [proxyPasswordHasColon, setColon] = useState(false);
  const [pending, setPending] = useState<{ key: SecretKey; fieldId: string; profileId: string } | null>(null);
  const [focusAfter, setFocusAfter] = useState<string | null>(null);
  // The window keeps its title while it closes.
  const shown = useRef<SecretKey | null>(null);
  if (pending) shown.current = pending.key;
  const live = useRef(true);

  const refresh = useCallback(async () => {
    const status = await window.xenon.secrets.status([...KEY_ORDER], profileId);
    if (!live.current) return;
    setSaved(status.saved);
    setColon(status.proxyPasswordHasColon);
  }, [profileId]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshOn]);

  // The box gets the cursor once the cleared secret's Clear button has gone.
  useEffect(() => {
    if (focusAfter === null) return;
    document.getElementById(focusAfter)?.focus();
    setFocusAfter(null);
  }, [focusAfter, saved]);

  const save = useCallback(
    async (key: SecretKey, value: string, savedOn: string) => {
      const label = KEYS.secrets[key].label;
      let result: SecretSaveResult = 'failed';
      try {
        result = await window.xenon.secrets.set(key, value, savedOn);
      } catch (err) {
        console.error('[Xenon Control] could not save a secret:', err);
      }
      if (result !== 'saved') {
        toast(result === 'keychain-unavailable' ? KEYS.keychainUnavailable(label) : KEYS.saveFailed(label), 'error');
        throw new Error(`${key} was not stored`);
      }
      await refresh();
      toast(KEYS.savedToast(label));
    },
    [refresh]
  );

  const clear = async () => {
    if (!pending) return;
    const { key, fieldId, profileId: clearOn } = pending;
    const label = KEYS.secrets[key].label;
    setPending(null);
    try {
      await window.xenon.secrets.clear(key, clearOn);
    } catch (err) {
      console.error('[Xenon Control] could not clear a secret:', err);
      toast(KEYS.clearFailed(label), 'error');
      return;
    }
    await refresh();
    setFocusAfter(fieldId);
    toast(KEYS.clearedToast(label));
  };

  const title = shown.current ? KEYS.clearConfirm(KEYS.secrets[shown.current].label) : '';
  // A profile's own secret is this profile's alone; an app-wide one goes for every profile that uses it.
  const help = shown.current && isProfileSecret(shown.current) ? KEYS.clearConfirmHelpOwn : KEYS.clearConfirmHelp;
  const dialog = (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      title={title}
      description={help}
    >
      <div className="flex shrink-0 items-center justify-end gap-2 px-5 py-3">
        <Button onClick={() => setPending(null)}>{COMMON.cancel}</Button>
        <Button variant="danger" onClick={() => void clear()}>
          {COMMON.clear}
        </Button>
      </div>
    </Dialog>
  );

  return {
    saved,
    proxyPasswordHasColon,
    save,
    askClear: (key, fieldId, clearOn) => setPending({ key, fieldId, profileId: clearOn }),
    dialog
  };
}
