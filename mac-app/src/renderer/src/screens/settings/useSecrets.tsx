import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SecretKey } from '@shared/types';
import { KEY_ORDER } from '../../keyRows';
import { KEYS } from '../../copy/keys';
import { COMMON } from '../../copy/common';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { toast } from '../../components/ui/toastStore';

export interface SecretsApi {
  /** Which Keychain secrets hold a value. Empty until the first answer. */
  saved: Partial<Record<SecretKey, boolean>>;
  /**
   * Stores a value in the Keychain and says so. When it can't, it says why and
   * throws, so the box keeps what was typed for another try.
   */
  save(key: SecretKey, value: string): Promise<void>;
  /**
   * Asks whether to clear a secret. Only the Keychain value goes: whether a
   * profile uses the key ("Used by this profile") is its own switch. Once it is
   * cleared, the cursor goes to the box `fieldId`, since Clear itself goes.
   */
  askClear(key: SecretKey, fieldId: string): void;
  /** The confirmation window; render it once. */
  dialog: ReactNode;
}

/**
 * The Keychain secrets Settings shows, shared by Essentials and Keys & accounts.
 * Their status is read again whenever `refreshOn` changes (a tab, or which
 * secrets the profile uses: a save can move a typed secret into the Keychain).
 */
export function useSecrets(refreshOn: unknown): SecretsApi {
  const [saved, setSaved] = useState<Partial<Record<SecretKey, boolean>>>({});
  const [pending, setPending] = useState<{ key: SecretKey; fieldId: string } | null>(null);
  const [focusAfter, setFocusAfter] = useState<string | null>(null);
  // The window keeps its title while it closes.
  const shown = useRef<SecretKey | null>(null);
  if (pending) shown.current = pending.key;
  const live = useRef(true);

  const refresh = useCallback(async () => {
    const status = await window.xenon.secrets.status([...KEY_ORDER]);
    if (live.current) setSaved(status as Partial<Record<SecretKey, boolean>>);
  }, []);

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
    async (key: SecretKey, value: string) => {
      const label = KEYS.secrets[key].label;
      let stored = false;
      try {
        stored = await window.xenon.secrets.set(key, value);
      } catch (err) {
        console.error('[Xenon Control] could not save a secret:', err);
      }
      if (!stored) {
        toast(KEYS.saveFailed(label), 'error');
        throw new Error(`${key} was not stored`);
      }
      await refresh();
      toast(KEYS.savedToast(label));
    },
    [refresh]
  );

  const clear = async () => {
    if (!pending) return;
    const { key, fieldId } = pending;
    const label = KEYS.secrets[key].label;
    setPending(null);
    try {
      await window.xenon.secrets.clear(key);
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
  const dialog = (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null);
      }}
      title={title}
      description={KEYS.clearConfirmHelp}
    >
      <div className="flex shrink-0 items-center justify-end gap-2 px-5 py-3">
        <Button onClick={() => setPending(null)}>{COMMON.cancel}</Button>
        <Button variant="danger" onClick={() => void clear()}>
          {COMMON.clear}
        </Button>
      </div>
    </Dialog>
  );

  return { saved, save, askClear: (key, fieldId) => setPending({ key, fieldId }), dialog };
}
