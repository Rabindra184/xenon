import { useId, type InputHTMLAttributes } from 'react';
import { cn } from '../../cn';
import { ERROR_CLASSES, LABEL_CLASSES, inputClasses } from './fieldStyles';

type NativeInput = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type' | 'className' | 'size'>;

/**
 * A one-line text box with a real <label>, an optional help line and an inline
 * error. The error is announced as it appears, and the box is marked invalid.
 * `settingKey` marks the wrapper with data-setting-key so focusSetting finds it.
 */
export function TextField({
  label,
  value,
  onChange,
  description,
  error,
  type = 'text',
  hideLabel = false,
  settingKey,
  id,
  ...input
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  error?: string;
  type?: 'text' | 'url' | 'email' | 'password' | 'search';
  /** Keep the label for screen readers but not on screen, for a field whose purpose the layout already shows. */
  hideLabel?: boolean;
  settingKey?: string;
  id?: string;
} & NativeInput) {
  const generated = useId();
  const fieldId = id ?? generated;
  const descriptionId = `${fieldId}-description`;
  const errorId = `${fieldId}-error`;
  const describedBy = [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div data-setting-key={settingKey} className="flex flex-col gap-1">
      <label htmlFor={fieldId} className={cn(LABEL_CLASSES, hideLabel && 'sr-only')}>
        {label}
      </label>
      <input
        {...input}
        id={fieldId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(inputClasses(!!error), 'w-full')}
      />
      {description && (
        <p id={descriptionId} className="text-xs text-muted">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className={ERROR_CLASSES}>
          {error}
        </p>
      )}
    </div>
  );
}
