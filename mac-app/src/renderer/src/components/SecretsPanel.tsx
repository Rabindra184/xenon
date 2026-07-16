import { useEffect, useState } from 'react';
import type { SecretDescriptor, SecretKey } from '@shared/types';
import { Check, KeyRound, X } from 'lucide-react';

interface Props {
  descriptors: SecretDescriptor[];
  /** Which secrets this profile injects. */
  selected: SecretKey[];
  onToggleSelected: (key: SecretKey, on: boolean) => void;
}

export function SecretsPanel({ descriptors, selected, onToggleSelected }: Props) {
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const refresh = async () => {
    const s = await window.xenon.secrets.status(descriptors.map((d) => d.key));
    setStatus(s);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (key: SecretKey) => {
    const value = drafts[key] ?? '';
    if (!value) return;
    await window.xenon.secrets.set(key, value);
    setDrafts((d) => ({ ...d, [key]: '' }));
    await refresh();
  };

  const clear = async (key: SecretKey) => {
    await window.xenon.secrets.clear(key);
    await refresh();
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Secrets are encrypted with the macOS Keychain (via Electron safeStorage) and injected as environment
        variables on the Appium process at launch. They are never written to the config file and never sent back to
        this window.
      </p>
      {descriptors.map((d) => {
        const isSet = status[d.key];
        const inProfile = selected.includes(d.key);
        return (
          <div key={d.key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound size={15} className="text-slate-400" />
                <span className="text-sm font-medium">{d.label}</span>
                <code className="text-[11px] text-slate-400">{d.key}</code>
                {isSet ? (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    <Check size={10} /> stored
                  </span>
                ) : (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800">
                    not set
                  </span>
                )}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={inProfile}
                  onChange={(e) => onToggleSelected(d.key, e.target.checked)}
                />
                inject in this profile
              </label>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{d.description}</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="password"
                placeholder={isSet ? '•••••••• (enter to replace)' : 'paste value'}
                value={drafts[d.key] ?? ''}
                onChange={(e) => setDrafts((s) => ({ ...s, [d.key]: e.target.value }))}
                className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
              <button
                onClick={() => save(d.key)}
                disabled={!drafts[d.key]}
                className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-fg disabled:opacity-40"
              >
                Save
              </button>
              {isSet && (
                <button
                  onClick={() => clear(d.key)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-slate-500 hover:text-rose-600 dark:border-slate-600"
                  title="Clear secret"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
