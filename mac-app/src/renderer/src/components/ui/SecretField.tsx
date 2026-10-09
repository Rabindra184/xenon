import { useState } from 'react';
import { COMMON } from '../../copy/common';
import { UI_COPY } from '../../copy/ui';
import { Button } from './Button';
import { FieldFrame, fieldDescribedBy, useFieldId, type FieldProps } from './Field';
import { inputClasses } from './fieldStyles';

export type SecretFieldProps = FieldProps & {
  saved: boolean;
  onSave: (value: string) => Promise<void>;
  onClear: () => void;
  /** What an empty, unsaved box says. Defaults to "Paste a key". */
  placeholder?: string;
  /**
   * What the secret is called in the names of Save and Clear ("Save Gemini key"), so each field's
   * buttons have names of their own. Defaults to the label.
   */
  name?: string;
};

/**
 * Where a secret is typed or pasted, never shown. When one is saved the box says
 * so ("•••••••• saved") and typing a new value replaces it; Clear is offered
 * then, and the caller decides whether to confirm it. The typed text is dropped
 * once it is saved, and kept if saving fails so Save can be tried again; the
 * caller says why it failed (a toast, or `error`).
 */
export function SecretField({
  label,
  saved,
  onSave,
  onClear,
  placeholder,
  name,
  description,
  error,
  settingKey,
  id,
  disabled,
  hideLabel
}: SecretFieldProps) {
  const fieldId = useFieldId(id);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const canSave = text.trim() !== '' && !saving && !disabled;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(text.trim());
      setText('');
    } catch {
      // The caller reports why. The text stays so Save can be pressed again.
    } finally {
      setSaving(false);
    }
  };

  return (
    <FieldFrame
      fieldId={fieldId}
      label={label}
      description={description}
      error={error}
      settingKey={settingKey}
      hideLabel={hideLabel}
    >
      <div className="flex items-center gap-2">
        <input
          id={fieldId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
          placeholder={saved ? UI_COPY.secretSaved : (placeholder ?? UI_COPY.secretEmpty)}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescribedBy(fieldId, { description, error })}
          className={`${inputClasses(!!error)} min-w-0 max-w-sm flex-1`}
        />
        {/* aria-disabled, not disabled: Save keeps focus through a save that empties the box (R20). */}
        <Button
          onClick={() => void save()}
          aria-disabled={!canSave || undefined}
          aria-label={UI_COPY.saveNamed(name ?? label)}
        >
          {COMMON.save}
        </Button>
        {saved && (
          <Button variant="quiet" onClick={onClear} disabled={disabled} aria-label={UI_COPY.clearNamed(name ?? label)}>
            {COMMON.clear}
          </Button>
        )}
      </div>
    </FieldFrame>
  );
}
