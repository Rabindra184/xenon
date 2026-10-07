import { useId, type ReactNode } from 'react';
import { cn } from '../../cn';
import { descriptionIdFor, errorIdFor } from '../../fieldA11y';
import { ERROR_CLASSES, LABEL_CLASSES } from './fieldStyles';

export { fieldDescribedBy } from '../../fieldA11y';

/** What every labelled field (TextField, NumberField, SecretField) takes. */
export interface FieldProps {
  label: string;
  /** A plain-words line under the control ("The dashboard can override this."). */
  description?: string;
  /** What is wrong with the value, under the control. It is announced as it appears, and the control is marked invalid. */
  error?: string;
  /** Marks the wrapper with data-setting-key, so focusSetting finds the control. */
  settingKey?: string;
  id?: string;
  disabled?: boolean;
  /** Keep the label for screen readers but not on screen, for a field whose purpose the layout already shows. */
  hideLabel?: boolean;
}

/** The control's id: the one given, or a generated one. */
export function useFieldId(id?: string): string {
  const generated = useId();
  return id ?? generated;
}

/**
 * The frame around a field's control: a real <label> above it, then the
 * description and the error under it, with the ids fieldDescribedBy points at.
 */
export function FieldFrame({
  fieldId,
  label,
  description,
  error,
  settingKey,
  hideLabel = false,
  children
}: Omit<FieldProps, 'id' | 'disabled'> & { fieldId: string; children: ReactNode }) {
  return (
    <div data-setting-key={settingKey} className="flex flex-col gap-1">
      <label htmlFor={fieldId} className={cn(LABEL_CLASSES, hideLabel && 'sr-only')}>
        {label}
      </label>
      {children}
      {description && (
        <p id={descriptionIdFor(fieldId)} className="text-xs text-muted">
          {description}
        </p>
      )}
      {error && (
        <p id={errorIdFor(fieldId)} role="alert" className={ERROR_CLASSES}>
          {error}
        </p>
      )}
    </div>
  );
}
