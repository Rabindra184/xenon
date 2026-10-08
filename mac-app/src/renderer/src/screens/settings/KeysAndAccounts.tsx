import type { Profile, SecretKey } from '@shared/types';
import { SECRET_DESCRIPTORS } from '@shared/secrets';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { keyRows } from '../../keyRows';
import { KEYS } from '../../copy/keys';
import { Group } from '../../components/ui/Group';
import { SecretField } from '../../components/ui/SecretField';
import { Switch } from '../../components/ui/Switch';
import type { SecretsApi } from './useSecrets';
import { TechnicalNote } from './FieldEditor';

export interface KeysAndAccountsProps {
  profile: Profile;
  secrets: SecretsApi;
  /** Turns "Used by this profile" on or off: the profile's `secretRefs`. */
  onUsed: (key: SecretKey, on: boolean) => void;
  technicalDetails: boolean;
}

/** The box of a secret on this tab, by its key: Clear puts the cursor back in it. */
export const keyFieldId = (key: SecretKey): string => `key-${key}`;

/**
 * Every Keychain secret, in plain words: what it is for, whether one is saved,
 * a box to save a new one, Clear (after asking), and whether this profile uses
 * it. The database file is listed with technical details on only. With them
 * on, each also shows the environment name it is passed as and Xenon's own
 * description of it.
 */
export function KeysAndAccounts({ profile, secrets, onUsed, technicalDetails }: KeysAndAccountsProps) {
  const used = Array.isArray(profile.secretRefs) ? profile.secretRefs : [];
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{KEYS.intro}</p>
      {keyRows(technicalDetails).map((key) => {
        const words = KEYS.secrets[key];
        const saved = secrets.saved[key] === true;
        const fieldId = keyFieldId(key);
        return (
          <Group key={key} title={words.label}>
            <div data-secret={key} className="flex items-start justify-between gap-4 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-sm text-ink">{words.purpose}</p>
                {technicalDetails && (
                  <TechnicalNote rawKey={key} description={SECRET_DESCRIPTORS.find((d) => d.key === key)?.description} />
                )}
              </div>
              <SavedState saved={saved} />
            </div>
            <div className="py-3">
              <SecretField
                id={fieldId}
                label={words.label}
                hideLabel
                saved={saved}
                placeholder={words.placeholder}
                onSave={(value) => secrets.save(key, value)}
                onClear={() => secrets.askClear(key, fieldId)}
              />
            </div>
            <div className="py-2">
              <Switch
                label={KEYS.usedByProfile}
                accessibleName={KEYS.usedByProfileName(words.label)}
                checked={used.includes(key)}
                onCheckedChange={(on) => onUsed(key, on)}
              />
            </div>
          </Group>
        );
      })}
    </div>
  );
}

/** Saved or Not set, each with an icon and words. */
function SavedState({ saved }: { saved: boolean }) {
  const Icon = saved ? CheckCircle2 : CircleDashed;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink">
      <Icon size={14} aria-hidden="true" className={saved ? 'text-ok' : 'text-muted'} />
      {saved ? KEYS.saved : KEYS.notSet}
    </span>
  );
}
