import { useId, useState } from 'react';
import { COMMON } from '../../copy/common';
import { UI_COPY } from '../../copy/ui';
import { Button } from './Button';
import { LABEL_CLASSES, inputClasses } from './fieldStyles';

/**
 * Where a secret is typed or pasted, never shown. When one is saved the box says
 * so ("•••••••• saved") and typing a new value replaces it; Clear is offered
 * then, and the caller decides whether to confirm it. The typed text is dropped
 * once it is saved, and kept if saving fails so Save can be tried again.
 */
export function SecretField({
  label,
  saved,
  onSave,
  onClear,
  placeholder,
  id
}: {
  label: string;
  saved: boolean;
  onSave: (value: string) => Promise<void>;
  onClear: () => void;
  /** What an empty, unsaved box says. Defaults to "Paste a key". */
  placeholder?: string;
  id?: string;
}) {
  const generated = useId();
  const fieldId = id ?? generated;
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const canSave = text.trim() !== '' && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(text.trim());
      setText('');
    } catch {
      // The caller reports why (a toast). The text stays so Save can be pressed again.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className={LABEL_CLASSES}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={fieldId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
          placeholder={saved ? UI_COPY.secretSaved : (placeholder ?? UI_COPY.secretEmpty)}
          className={`${inputClasses(false)} min-w-0 max-w-sm flex-1`}
        />
        <Button onClick={() => void save()} disabled={!canSave}>
          {COMMON.save}
        </Button>
        {saved && (
          <Button variant="quiet" onClick={onClear}>
            {COMMON.clear}
          </Button>
        )}
      </div>
    </div>
  );
}
