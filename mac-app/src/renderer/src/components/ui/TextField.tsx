import type { InputHTMLAttributes } from 'react';
import { cn } from '../../cn';
import { FieldFrame, fieldDescribedBy, useFieldId, type FieldProps } from './Field';
import { inputClasses } from './fieldStyles';

type NativeInput = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  keyof FieldProps | 'onChange' | 'value' | 'type' | 'className' | 'size'
>;

export type TextFieldProps = FieldProps & {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'url' | 'email' | 'password' | 'search';
} & NativeInput;

/**
 * A one-line text box with a real <label>, an optional description and an
 * inline error (see FieldProps). The error is announced as it appears, and the
 * box is marked invalid.
 */
export function TextField({
  label,
  value,
  onChange,
  description,
  error,
  type = 'text',
  hideLabel,
  settingKey,
  id,
  disabled,
  ...input
}: TextFieldProps) {
  const fieldId = useFieldId(id);
  return (
    <FieldFrame
      fieldId={fieldId}
      label={label}
      description={description}
      error={error}
      settingKey={settingKey}
      hideLabel={hideLabel}
    >
      <input
        {...input}
        id={fieldId}
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescribedBy(fieldId, { description, error })}
        className={cn(inputClasses(!!error), 'w-full')}
      />
    </FieldFrame>
  );
}
