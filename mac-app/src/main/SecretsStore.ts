import { safeStorage } from 'electron';
import Store from 'electron-store';
import type { SecretSlot } from '@shared/types';

// Secrets are encrypted with Electron safeStorage — which derives its key from
// the macOS Keychain — and the ciphertext is persisted in a dedicated store.
// The renderer can only set/clear a secret or read its set/unset status; raw
// values are never sent back over IPC and are only decrypted in-process when
// building the launch environment.
//
// A slot is a secret's name (an app-wide secret), or its name and a profile's
// id (a profile's own, `CLOUD_KEY@<id>`: shared/secrets.ts). Slot names are
// taken as they are, never as dotted paths, so no profile id can reach into
// another slot.
export class SecretsStore {
  private store = new Store<Record<string, string>>({
    name: 'secrets',
    // Cleartext is never written here — only base64 ciphertext.
    encryptionKey: undefined,
    accessPropertiesByDotNotation: false
  });

  /** Whether this Mac's Keychain can encrypt a value now. */
  get available(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  set(slot: SecretSlot, value: string): void {
    if (!value) {
      this.clear(slot);
      return;
    }
    if (!this.available) {
      throw new Error('OS encryption (Keychain) is unavailable; cannot store secret securely.');
    }
    const cipher = safeStorage.encryptString(value).toString('base64');
    this.store.set(slot, cipher);
  }

  clear(slot: SecretSlot): void {
    this.store.delete(slot);
  }

  has(slot: SecretSlot): boolean {
    return this.store.has(slot);
  }

  /** Decrypt a single secret for in-process use (launch env). Never exposed over IPC. */
  reveal(slot: SecretSlot): string | null {
    const cipher = this.store.get(slot);
    if (typeof cipher !== 'string' || !cipher) return null;
    try {
      return safeStorage.decryptString(Buffer.from(cipher, 'base64'));
    } catch {
      return null;
    }
  }
}
