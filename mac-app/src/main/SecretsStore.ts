import { safeStorage } from 'electron';
import Store from 'electron-store';
import type { SecretKey } from '@shared/types';

// Secrets are encrypted with Electron safeStorage — which derives its key from
// the macOS Keychain — and the ciphertext is persisted in a dedicated store.
// The renderer can only set/clear a secret or read its set/unset status; raw
// values are never sent back over IPC and are only decrypted in-process when
// building the launch environment.
export class SecretsStore {
  private store = new Store<Record<string, string>>({
    name: 'secrets',
    // Cleartext is never written here — only base64 ciphertext.
    encryptionKey: undefined
  });

  private get available(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  set(key: SecretKey, value: string): void {
    if (!value) {
      this.clear(key);
      return;
    }
    if (!this.available) {
      throw new Error('OS encryption (Keychain) is unavailable; cannot store secret securely.');
    }
    const cipher = safeStorage.encryptString(value).toString('base64');
    this.store.set(key, cipher);
  }

  clear(key: SecretKey): void {
    this.store.delete(key);
  }

  has(key: SecretKey): boolean {
    return this.store.has(key);
  }

  /** Decrypt a single secret for in-process use (launch env). Never exposed over IPC. */
  reveal(key: SecretKey): string | null {
    const cipher = this.store.get(key);
    if (!cipher) return null;
    try {
      return safeStorage.decryptString(Buffer.from(cipher, 'base64'));
    } catch {
      return null;
    }
  }

  /** set/unset status for every requested key — safe to return to the renderer. */
  status(keys: SecretKey[]): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const k of keys) out[k] = this.has(k);
    return out;
  }
}
